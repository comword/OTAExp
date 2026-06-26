#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace gtdev::ota {

// Wire-protocol constants, kept in sync with the reference Python `bleak` push
// tool. The native engine is the single source of truth for the protocol; the
// JS BLE transport reads these through getProtocolConfig().
namespace protocol {
inline constexpr const char* kDeviceName = "Tracin-Test-IDF";
inline constexpr const char* kControlCharUuid =
    "fdec0002-8e10-4a5f-b8a3-1f2a3b4c5d6e";
inline constexpr const char* kDataCharUuid =
    "fdec0003-8e10-4a5f-b8a3-1f2a3b4c5d6e";
inline constexpr const char* kStatusCharUuid =
    "fdec0004-8e10-4a5f-b8a3-1f2a3b4c5d6e";
inline constexpr const char* kFirmwareRevisionCharUuid =
    "00002a26-0000-1000-8000-00805f9b34fb";

inline constexpr uint8_t kCmdStart = 0x01;
inline constexpr uint8_t kCmdFinish = 0x03;

inline constexpr uint8_t kStatusReady = 0x10;
inline constexpr uint8_t kStatusProgress = 0x11;
inline constexpr uint8_t kStatusError = 0x20;
inline constexpr uint8_t kStatusFinished = 0x30;

inline constexpr size_t kVersionLength = 32;
inline constexpr int kMinChunkSize = 100;
inline constexpr int kMaxChunkSize = 512;
} // namespace protocol

enum class Phase {
  Idle,
  Starting,
  Transferring,
  Flushing,
  Finishing,
  Completed,
  Failed,
};

enum class StatusKind {
  Ready,
  Progress,
  Error,
  Finished,
  Unknown,
};

const char* phaseName(Phase phase);
const char* statusKindName(StatusKind kind);

struct SessionInfo {
  size_t totalBytes = 0;
  int chunkSize = 0;
  size_t totalChunks = 0;
};

struct DataChunk {
  std::vector<uint8_t> payload;
  size_t offset = 0;
  size_t length = 0;
  bool isLast = false;
  bool hasData = false;
};

struct StatusEvent {
  StatusKind kind = StatusKind::Unknown;
  uint8_t rawStatus = 0;
  uint8_t errorCode = 0;
  uint32_t bytesWritten = 0;
};

struct Progress {
  Phase phase = Phase::Idle;
  size_t bytesSent = 0;
  size_t bytesConfirmed = 0;
  size_t totalBytes = 0;
  int percent = 0;
};

// Pure OTA protocol/state machine. It owns the firmware image and the transfer
// cursor, builds the GATT packets, parses status notifications and tracks
// progress. It performs no I/O: the JS BLE transport drives it step by step,
// mirroring the control flow of the reference Python tool.
class OtaEngine {
 public:
  // Clamps an ATT MTU to a usable DATA payload size.
  // Equivalent to Python's max(100, min(mtu - 3, 512)).
  static int computeChunkSize(int mtuSize);

  // Loads a firmware image and (re)initialises the session. Moves to Starting.
  SessionInfo beginSession(std::vector<uint8_t> firmware, std::string version, int mtuSize);

  // Recomputes the chunk size for a new MTU (e.g. after a reconnect).
  int updateMtu(int mtuSize);

  // Control packets for the control characteristic.
  std::vector<uint8_t> buildStartCommand() const;
  std::vector<uint8_t> buildFinishCommand() const;

  // Returns the chunk at the current cursor without advancing it.
  DataChunk nextChunk() const;

  // Advances the cursor after a successful DATA write (Python: off += len).
  Progress confirmChunkWritten(size_t byteLength);

  // Resets the cursor to the start of the image (reconnect path, Python off=0).
  Progress rewindToStart();

  // Parses a raw status notification without mutating state.
  StatusEvent parseStatus(const std::vector<uint8_t>& bytes) const;

  // Parses and folds a status notification into the session state.
  Progress applyStatus(const std::vector<uint8_t>& bytes);

  Progress progress() const;
  bool isTransferComplete() const;
  bool isFlashConfirmed() const;
  void abort();

 private:
  std::vector<uint8_t> firmware_;
  std::string version_;
  size_t offset_ = 0;
  size_t bytesConfirmed_ = 0;
  int chunkSize_ = protocol::kMaxChunkSize;
  Phase phase_ = Phase::Idle;
};

} // namespace gtdev::ota
