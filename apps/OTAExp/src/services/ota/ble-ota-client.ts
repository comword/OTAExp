import { NativeLibOTAModule } from '@gtdev/rtn-libota';
import type {
  OtaProgress,
  OtaProtocolConfig,
  OtaStatusEvent,
  OtaStatusKind,
} from '@gtdev/rtn-libota';
import { Device, type Subscription } from 'react-native-ble-plx';

import { bleSession } from '../ble/ble-session';

export type OtaUpdateOptions = {
  /** Absolute filesystem path to the firmware image (read natively). */
  firmwarePath: string;
  /** Version string packed into the START command. */
  version: string;
  flushTimeoutMs?: number;
  maxReconnects?: number;
};

export type BleOtaClientCallbacks = {
  onProgress?: (progress: OtaProgress) => void;
  onLog?: (message: string) => void;
};

type StatusWaiter = {
  kinds: OtaStatusKind[];
  resolve: (event: OtaStatusEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * BLE transport that drives the pure C++ OTA engine over an existing connection.
 *
 * The device must already be connected through the shared `bleSession` (e.g. on
 * the Devices screen); this client does not scan. It owns no protocol logic of
 * its own: it asks the native engine what bytes to write, hands every status
 * notification back to the engine, and lets the engine track progress and the
 * transfer cursor. Reconnects (the device reboots mid-OTA) go through the same
 * shared session so the connection state stays consistent across screens.
 *
 * Note: `react-native-ble-plx` already exchanges characteristic values as base64
 * strings, which is exactly the format the engine produces and consumes — so no
 * manual byte conversion is needed on the JS side.
 */
export class BleOtaClient {
  private readonly config: OtaProtocolConfig =
    NativeLibOTAModule.getProtocolConfig();

  private device: Device | null = null;
  private deviceId: string | null = null;
  private readonly charToService = new Map<string, string>();
  private statusSub: Subscription | null = null;
  private statusWaiters: StatusWaiter[] = [];
  private cancelled = false;

  private onProgress?: (progress: OtaProgress) => void;
  private onLog?: (message: string) => void;

  constructor(callbacks: BleOtaClientCallbacks = {}) {
    this.onProgress = callbacks.onProgress;
    this.onLog = callbacks.onLog;
  }

  /**
   * Runs the full OTA against the already-connected device: prepare -> START ->
   * stream -> flush -> FINISH. Throws if no device is connected.
   */
  async update(options: OtaUpdateOptions): Promise<void> {
    this.cancelled = false;

    const device = bleSession.connectedDevice;
    if (!device) {
      throw new Error(
        'No connected device. Connect to a device on the Devices tab first.',
      );
    }
    this.device = device;
    this.deviceId = device.id;
    this.log(`Using connected device ${device.name ?? device.id}`);

    await this.prepareDevice(device);
    const mtu = device.mtu ?? 23;
    this.log(`Ready, MTU=${mtu}`);

    const current = await this.readCurrentFirmware();
    if (current) {
      this.log(`Current firmware: ${current}`);
    }

    const info = NativeLibOTAModule.beginSession(
      options.firmwarePath,
      options.version,
      mtu,
    );
    this.log(
      `Session: ${info.totalBytes}B, chunk=${info.chunkSize}, ` +
        `${info.totalChunks} chunks`,
    );
    this.emitProgress();

    await this.sendStart();
    await this.transferLoop(options);

    this.log('Transfer complete, waiting for flash write ...');
    const flushed = await this.waitForFlash(options.flushTimeoutMs ?? 120000);
    this.log(flushed ? 'Flash confirmed on device' : 'Flash wait timed out');

    await this.sendFinish();
    this.log('OTA complete');
  }

  /** Requests cancellation; the in-flight transfer loop stops at its next step. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Detaches this client's status subscription and pending waiters. The shared
   * BLE connection is intentionally left intact (owned by `bleSession`).
   */
  async destroy(): Promise<void> {
    this.rejectWaiters(new Error('Closed'));
    this.statusSub?.remove();
    this.statusSub = null;
    this.device = null;
  }

  // --- connection prep -----------------------------------------------------

  private async prepareDevice(device: Device): Promise<void> {
    this.device = device;
    await this.buildCharacteristicMap(device);
    await this.subscribeStatus(device);
  }

  private async buildCharacteristicMap(device: Device): Promise<void> {
    this.charToService.clear();
    const services = await device.services();
    for (const service of services) {
      const characteristics = await service.characteristics();
      for (const characteristic of characteristics) {
        this.charToService.set(characteristic.uuid.toLowerCase(), service.uuid);
      }
    }
  }

  private serviceFor(charUuid: string): string {
    const service = this.charToService.get(charUuid.toLowerCase());
    if (!service) {
      throw new Error(`Characteristic ${charUuid} not found on device`);
    }
    return service;
  }

  private async subscribeStatus(device: Device): Promise<void> {
    this.statusSub?.remove();
    const service = this.serviceFor(this.config.statusCharUuid);
    this.statusSub = device.monitorCharacteristicForService(
      service,
      this.config.statusCharUuid,
      (error, characteristic) => {
        if (error) {
          // Disconnection / cancellation surfaces here; the transfer loop and
          // its reconnect path handle recovery, so just stop dispatching.
          return;
        }
        const value = characteristic?.value;
        if (value) {
          this.handleStatusNotification(value);
        }
      },
    );
  }

  // --- protocol steps ------------------------------------------------------

  private async sendStart(): Promise<void> {
    this.log('START ...');
    await this.writeControl(NativeLibOTAModule.buildStartCommand());
    const event = await this.waitForStatus(['ready', 'error'], 30000);
    if (event.kind === 'error') {
      throw new Error(`Device rejected START (error=${event.errorCode})`);
    }
    this.log('Device READY');
  }

  private async transferLoop(options: OtaUpdateOptions): Promise<void> {
    const maxReconnects = options.maxReconnects ?? 25;
    let reconnects = 0;

    while (!NativeLibOTAModule.isTransferComplete()) {
      if (this.cancelled) {
        throw new Error('OTA cancelled');
      }

      const chunk = NativeLibOTAModule.nextChunk();
      if (!chunk.hasData) {
        break;
      }

      try {
        await this.writeData(chunk.payloadBase64);
        NativeLibOTAModule.confirmChunkWritten(chunk.length);
        this.emitProgress();
      } catch (error) {
        reconnects += 1;
        if (reconnects > maxReconnects) {
          throw new Error('Too many reconnects, aborting OTA');
        }
        this.log(
          `[reconnect ${reconnects}] at offset ${chunk.offset}: ` +
            `${describeError(error)}`,
        );
        await this.reconnectAndRestart(options);
      }
    }
  }

  private async reconnectAndRestart(_options: OtaUpdateOptions): Promise<void> {
    if (!this.deviceId) {
      throw new Error('No device to reconnect to');
    }

    this.statusSub?.remove();
    this.statusSub = null;
    this.rejectWaiters(new Error('Reconnecting'));

    await bleSession.disconnect();
    await delay(1500);

    const device = await bleSession.connect(this.deviceId);
    await this.prepareDevice(device);

    // Device restarts the transfer: re-negotiate chunking and rewind to 0.
    NativeLibOTAModule.updateMtu(device.mtu ?? 23);
    NativeLibOTAModule.rewindToStart();
    this.emitProgress();
    await this.sendStart();
    this.log('Reconnected, restarting transfer from the beginning');
  }

  private async sendFinish(): Promise<void> {
    this.log('FINISH ...');
    try {
      await this.writeControl(NativeLibOTAModule.buildFinishCommand());
    } catch {
      this.log('(device may have rebooted)');
    }
    try {
      const event = await this.waitForStatus(['finished', 'error'], 15000);
      this.log(
        event.kind === 'finished'
          ? 'Device confirmed COMPLETE, rebooting'
          : `FINISH error (error=${event.errorCode})`,
      );
    } catch {
      this.log('done (device may have rebooted)');
    }
  }

  // --- characteristic IO ---------------------------------------------------

  private async writeControl(valueBase64: string): Promise<void> {
    const service = this.serviceFor(this.config.controlCharUuid);
    await this.requireDevice().writeCharacteristicWithResponseForService(
      service,
      this.config.controlCharUuid,
      valueBase64,
    );
  }

  private async writeData(valueBase64: string): Promise<void> {
    const service = this.serviceFor(this.config.dataCharUuid);
    await this.requireDevice().writeCharacteristicWithResponseForService(
      service,
      this.config.dataCharUuid,
      valueBase64,
    );
  }

  private async readCurrentFirmware(): Promise<string | null> {
    try {
      const service = this.serviceFor(this.config.firmwareRevisionCharUuid);
      const characteristic = await this.requireDevice().readCharacteristicForService(
        service,
        this.config.firmwareRevisionCharUuid,
      );
      if (!characteristic.value) {
        return null;
      }
      return decodeAsciiBase64(characteristic.value);
    } catch {
      return null;
    }
  }

  // --- status notification dispatch ----------------------------------------

  private handleStatusNotification(valueBase64: string): void {
    const event = NativeLibOTAModule.parseStatus(valueBase64);
    NativeLibOTAModule.applyStatus(valueBase64);
    this.emitProgress();

    for (const waiter of [...this.statusWaiters]) {
      if (waiter.kinds.includes(event.kind)) {
        clearTimeout(waiter.timer);
        this.statusWaiters = this.statusWaiters.filter((w) => w !== waiter);
        waiter.resolve(event);
      }
    }
  }

  private waitForStatus(
    kinds: OtaStatusKind[],
    timeoutMs: number,
  ): Promise<OtaStatusEvent> {
    return new Promise<OtaStatusEvent>((resolve, reject) => {
      const waiter: StatusWaiter = {
        kinds,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.statusWaiters = this.statusWaiters.filter((w) => w !== waiter);
          reject(new Error(`Timed out waiting for status: ${kinds.join('/')}`));
        }, timeoutMs),
      };
      this.statusWaiters.push(waiter);
    });
  }

  private async waitForFlash(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (NativeLibOTAModule.isFlashConfirmed()) {
        return true;
      }
      if (this.cancelled) {
        return false;
      }
      await delay(500);
    }
    return NativeLibOTAModule.isFlashConfirmed();
  }

  private rejectWaiters(error: Error): void {
    const waiters = this.statusWaiters;
    this.statusWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  // --- helpers -------------------------------------------------------------

  private requireDevice(): Device {
    if (!this.device) {
      throw new Error('Not connected to a device');
    }
    return this.device;
  }

  private emitProgress(): void {
    this.onProgress?.(NativeLibOTAModule.getProgress());
  }

  private log(message: string): void {
    this.onLog?.(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Decodes an ASCII (e.g. firmware revision) base64 value and trims null bytes. */
function decodeAsciiBase64(value: string): string {
  const binary = globalThis.atob(value);
  return binary.replace(/\0+$/, '').trim();
}
