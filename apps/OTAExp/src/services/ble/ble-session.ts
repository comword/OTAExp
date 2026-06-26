import { Platform } from 'react-native';
import {
  BleManager,
  Device,
  State,
  type Subscription,
} from 'react-native-ble-plx';

import { requestBlePermissions } from '../ota/permissions';

export type ScannedDevice = {
  id: string;
  name: string | null;
  rssi: number | null;
  isConnectable: boolean | null;
};

export type ScanCallbacks = {
  onDeviceFound?: (device: ScannedDevice) => void;
  onScanningChange?: (scanning: boolean) => void;
  onError?: (error: Error) => void;
};

type ConnectionListener = (device: ScannedDevice | null) => void;

const DEFAULT_SCAN_TIMEOUT_MS = 15000;

function summarize(device: Device): ScannedDevice {
  return {
    id: device.id,
    name: device.name ?? device.localName ?? null,
    rssi: device.rssi ?? null,
    isConnectable: device.isConnectable ?? null,
  };
}

/**
 * Process-wide BLE session shared by the Devices screen (scan + connect) and the
 * OTA flow. It owns a single `BleManager`, so a peripheral connected on one
 * screen stays connected for the other: the OTA transfer reuses the active
 * connection instead of re-scanning for a fixed device name.
 */
class BleSession {
  readonly manager = new BleManager();

  private connected: Device | null = null;
  private disconnectSub: Subscription | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanning = false;
  private scanCallbacks: ScanCallbacks | null = null;
  private readonly listeners = new Set<ConnectionListener>();

  get connectedDevice(): Device | null {
    return this.connected;
  }

  get connectedSummary(): ScannedDevice | null {
    return this.connected ? summarize(this.connected) : null;
  }

  get isScanning(): boolean {
    return this.scanning;
  }

  /**
   * Subscribes to connection changes. The listener is invoked immediately with
   * the current state and on every later change; returns an unsubscribe fn.
   */
  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    listener(this.connectedSummary);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts scanning for nearby peripherals; auto-stops after `timeoutMs`. */
  async startScan(
    callbacks: ScanCallbacks,
    timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
  ): Promise<void> {
    if (this.scanning) {
      return;
    }

    const permitted = await requestBlePermissions();
    if (!permitted) {
      throw new Error('Bluetooth permissions were not granted');
    }
    await this.ensurePoweredOn();

    this.scanCallbacks = callbacks;
    this.setScanning(true);
    this.scanTimer = setTimeout(() => this.stopScan(), timeoutMs);

    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        this.stopScan();
        callbacks.onError?.(error);
        return;
      }
      if (device) {
        callbacks.onDeviceFound?.(summarize(device));
      }
    });
  }

  stopScan(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.scanning) {
      this.manager.stopDeviceScan();
      this.setScanning(false);
    }
    this.scanCallbacks = null;
  }

  /** Connects, negotiates MTU (Android), and discovers services/characteristics. */
  async connect(deviceId: string): Promise<Device> {
    this.stopScan();

    let device = await this.manager.connectToDevice(deviceId, {
      timeout: 20000,
    });

    if (Platform.OS === 'android') {
      try {
        device = await device.requestMTU(247);
      } catch {
        // Keep the default MTU if the peripheral rejects the request.
      }
    }

    await device.discoverAllServicesAndCharacteristics();

    this.disconnectSub?.remove();
    this.disconnectSub = this.manager.onDeviceDisconnected(deviceId, () => {
      if (this.connected?.id === deviceId) {
        this.setConnected(null);
      }
    });

    this.setConnected(device);
    return device;
  }

  async disconnect(): Promise<void> {
    const id = this.connected?.id;
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    this.setConnected(null);
    if (id) {
      try {
        await this.manager.cancelDeviceConnection(id);
      } catch {
        // Already disconnected.
      }
    }
  }

  private setConnected(device: Device | null): void {
    this.connected = device;
    const summary = this.connectedSummary;
    this.listeners.forEach((listener) => listener(summary));
  }

  private setScanning(scanning: boolean): void {
    this.scanning = scanning;
    this.scanCallbacks?.onScanningChange?.(scanning);
  }

  private async ensurePoweredOn(timeoutMs = 5000): Promise<void> {
    const state = await this.manager.state();
    if (state === State.PoweredOn) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.remove();
        reject(new Error('Bluetooth is not powered on'));
      }, timeoutMs);
      const subscription = this.manager.onStateChange((next) => {
        if (next === State.PoweredOn) {
          clearTimeout(timer);
          subscription.remove();
          resolve();
        }
      }, true);
    });
  }
}

/** Single shared instance used across screens and the OTA transfer. */
export const bleSession = new BleSession();

export type { BleSession };
