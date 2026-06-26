import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native/Libraries/TurboModule/RCTExport';
// import type {TurboModule} from 'react-native'; in future versions

/**
 * GATT identifiers and protocol constants the JS BLE transport needs in order
 * to talk to the device. These mirror the constants of the reference Python
 * `bleak` push tool so the native engine stays the single source of truth for
 * the wire protocol.
 */
export type OtaProtocolConfig = {
  /** Default advertised name to scan for (Python: DEVICE_NAME). */
  deviceName: string;
  /** Control characteristic, receives START / FINISH commands (OTA_CTRL). */
  controlCharUuid: string;
  /** Data characteristic, receives the firmware payload chunks (OTA_DATA). */
  dataCharUuid: string;
  /** Status characteristic, notifies progress / ready / error (OTA_STATUS). */
  statusCharUuid: string;
  /** DIS firmware revision characteristic used to read current FW (DIS_FW_REV). */
  firmwareRevisionCharUuid: string;
  /** Fixed-width version field packed into the START command (VERSION_LEN = 32). */
  versionLength: number;
  /** Control opcode that begins a transfer (CMD_START = 0x01). */
  cmdStart: number;
  /** Control opcode that finalises a transfer (CMD_FINISH = 0x03). */
  cmdFinish: number;
  /** Device reports it is ready to receive data (ST_READY = 0x10). */
  statusReady: number;
  /** Device reports bytes flushed to flash so far (ST_PROGRESS = 0x11). */
  statusProgress: number;
  /** Device reports an error, second byte carries the code (ST_ERROR = 0x20). */
  statusError: number;
  /** Device reports the image was accepted and it will reboot (ST_FINISHED = 0x30). */
  statusFinished: number;
  /** Smallest chunk size the engine will ever negotiate. */
  minChunkSize: number;
  /** Largest chunk size the engine will ever negotiate. */
  maxChunkSize: number;
};

/** High-level phase of the OTA session state machine. */
export type OtaPhase =
  | 'idle'
  | 'starting'
  | 'transferring'
  | 'flushing'
  | 'finishing'
  | 'completed'
  | 'failed';

/** Result of starting a session: the totals the UI/transport plan around. */
export type OtaSessionInfo = {
  /** Total firmware size in bytes (Python: total). */
  totalBytes: number;
  /** Negotiated payload size per DATA write (Python: chunk). */
  chunkSize: number;
  /** Number of chunks required to send the whole image. */
  totalChunks: number;
};

/**
 * A single payload to write to the DATA characteristic. `hasData` is false once
 * the whole image has been emitted, matching the Python `while off < total`
 * loop termination.
 */
export type OtaDataChunk = {
  /** Base64-encoded bytes to write to the DATA characteristic. */
  payloadBase64: string;
  /** Byte offset of this chunk within the firmware image. */
  offset: number;
  /** Number of bytes in this chunk (0 when the transfer is complete). */
  length: number;
  /** True when this is the final chunk of the image. */
  isLast: boolean;
  /** False when there is nothing left to send. */
  hasData: boolean;
};

/** Classification of a status notification kind, derived from its first byte. */
export type OtaStatusKind = 'ready' | 'progress' | 'error' | 'finished' | 'unknown';

/** Parsed contents of a single OTA_STATUS notification. */
export type OtaStatusEvent = {
  kind: OtaStatusKind;
  /** Raw first byte of the notification (the status code). */
  rawStatus: number;
  /** Error code from byte[1] when `kind === 'error'`, otherwise 0. */
  errorCode: number;
  /** Little-endian uint32 from bytes[1..4] when `kind === 'progress'`, otherwise 0. */
  bytesWritten: number;
};

/** Snapshot of session progress, suitable for driving a progress UI. */
export type OtaProgress = {
  phase: OtaPhase;
  /** Bytes handed to the transport so far (Python: off). */
  bytesSent: number;
  /** Bytes the device has confirmed flushed to flash (Python: written). */
  bytesConfirmed: number;
  /** Total image size in bytes. */
  totalBytes: number;
  /** Integer completion percentage based on confirmed bytes (0..100). */
  percent: number;
};

export interface Spec extends TurboModule {
  /**
   * Returns the wire-protocol constants (GATT UUIDs, opcodes, status codes,
   * chunk bounds). The JS BLE layer uses these to locate characteristics and
   * subscribe to notifications.
   */
  getProtocolConfig: () => OtaProtocolConfig;

  /**
   * Computes the DATA payload size for a given ATT MTU, clamped to the engine's
   * bounds. Equivalent to Python's `max(100, min(mtu_size - 3, 512))`.
   */
  computeChunkSize: (mtuSize: number) => number;

  /**
   * Loads the firmware image into the native engine and initialises a session.
   * The native side reads the file from disk once and then serves chunks from
   * native memory. Moves the state machine to the `starting` phase.
   *
   * @param firmwarePath File path to the firmware image.
   * @param version Human-readable version string packed into the START command.
   * @param mtuSize Current negotiated ATT MTU, used to size chunks.
   */
  beginSession: (firmwarePath: string, version: string, mtuSize: number) => OtaSessionInfo;

  /**
   * Re-negotiates the chunk size after the MTU changes (e.g. following a
   * reconnect) and returns the new chunk size. Does not move the offset.
   */
  updateMtu: (mtuSize: number) => number;

  /**
   * Builds the base64 START command to write to the control characteristic:
   * `[CMD_START] + uint32_le(totalBytes) + version padded/truncated to 32 bytes`.
   */
  buildStartCommand: () => string;

  /** Builds the base64 FINISH command (`[CMD_FINISH]`) for the control characteristic. */
  buildFinishCommand: () => string;

  /**
   * Returns the next DATA payload to write, starting at the current offset.
   * Does not advance the offset; call {@link confirmChunkWritten} after the
   * transport reports a successful write.
   */
  nextChunk: () => OtaDataChunk;

  /**
   * Advances the send offset after the transport successfully writes a chunk
   * (Python: `off += len(data)`), transitioning to `flushing` once the whole
   * image has been sent. Returns the updated progress snapshot.
   */
  confirmChunkWritten: (byteLength: number) => OtaProgress;

  /**
   * Resets the send offset to the beginning of the image. Used on the reconnect
   * path where the device restarts the transfer (Python: `off = 0`).
   */
  rewindToStart: () => OtaProgress;

  /**
   * Parses a raw OTA_STATUS notification without mutating session state. Useful
   * for transports that want to inspect a notification (e.g. abort on error)
   * before feeding it back in.
   */
  parseStatus: (statusBase64: string) => OtaStatusEvent;

  /**
   * Parses a status notification and folds it into the session state: updates
   * confirmed bytes on PROGRESS, transitions to `completed` on FINISHED, and to
   * `failed` on ERROR. Returns the updated progress snapshot.
   */
  applyStatus: (statusBase64: string) => OtaProgress;

  /** Returns the current progress snapshot. */
  getProgress: () => OtaProgress;

  /** True once every byte has been handed to the transport (Python: `off >= total`). */
  isTransferComplete: () => boolean;

  /** True once the device has confirmed the whole image was flushed to flash. */
  isFlashConfirmed: () => boolean;

  /** Discards any in-flight session and returns the engine to the idle phase. */
  abortSession: () => void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeLibOTAModule');
