#include "OtaEngine.h"

#include <algorithm>

namespace gtdev::ota {

const char* phaseName(Phase phase) {
  switch (phase) {
    case Phase::Idle:
      return "idle";
    case Phase::Starting:
      return "starting";
    case Phase::Transferring:
      return "transferring";
    case Phase::Flushing:
      return "flushing";
    case Phase::Finishing:
      return "finishing";
    case Phase::Completed:
      return "completed";
    case Phase::Failed:
      return "failed";
  }
  return "idle";
}

const char* statusKindName(StatusKind kind) {
  switch (kind) {
    case StatusKind::Ready:
      return "ready";
    case StatusKind::Progress:
      return "progress";
    case StatusKind::Error:
      return "error";
    case StatusKind::Finished:
      return "finished";
    case StatusKind::Unknown:
      return "unknown";
  }
  return "unknown";
}

int OtaEngine::computeChunkSize(int mtuSize) {
  const int usable = mtuSize - 3;
  return std::clamp(usable, protocol::kMinChunkSize, protocol::kMaxChunkSize);
}

SessionInfo OtaEngine::beginSession(
    std::vector<uint8_t> firmware,
    std::string version,
    int mtuSize) {
  firmware_ = std::move(firmware);
  version_ = std::move(version);
  offset_ = 0;
  bytesConfirmed_ = 0;
  chunkSize_ = computeChunkSize(mtuSize);
  phase_ = Phase::Starting;

  SessionInfo info;
  info.totalBytes = firmware_.size();
  info.chunkSize = chunkSize_;
  info.totalChunks = chunkSize_ > 0
      ? (firmware_.size() + static_cast<size_t>(chunkSize_) - 1) /
          static_cast<size_t>(chunkSize_)
      : 0;
  return info;
}

int OtaEngine::updateMtu(int mtuSize) {
  chunkSize_ = computeChunkSize(mtuSize);
  return chunkSize_;
}

std::vector<uint8_t> OtaEngine::buildStartCommand() const {
  // [CMD_START][uint32 little-endian total size][version padded/truncated to 32]
  std::vector<uint8_t> cmd;
  cmd.reserve(1 + 4 + protocol::kVersionLength);
  cmd.push_back(protocol::kCmdStart);

  const uint32_t total = static_cast<uint32_t>(firmware_.size());
  cmd.push_back(static_cast<uint8_t>(total & 0xFF));
  cmd.push_back(static_cast<uint8_t>((total >> 8) & 0xFF));
  cmd.push_back(static_cast<uint8_t>((total >> 16) & 0xFF));
  cmd.push_back(static_cast<uint8_t>((total >> 24) & 0xFF));

  for (size_t i = 0; i < protocol::kVersionLength; ++i) {
    cmd.push_back(i < version_.size() ? static_cast<uint8_t>(version_[i]) : 0);
  }
  return cmd;
}

std::vector<uint8_t> OtaEngine::buildFinishCommand() const {
  return {protocol::kCmdFinish};
}

DataChunk OtaEngine::nextChunk() const {
  DataChunk chunk;
  chunk.offset = offset_;
  if (offset_ >= firmware_.size() || chunkSize_ <= 0) {
    chunk.hasData = false;
    chunk.length = 0;
    chunk.isLast = firmware_.empty() ? false : offset_ >= firmware_.size();
    return chunk;
  }

  const size_t length = std::min(
      static_cast<size_t>(chunkSize_), firmware_.size() - offset_);
  chunk.payload.assign(
      firmware_.begin() + static_cast<std::ptrdiff_t>(offset_),
      firmware_.begin() + static_cast<std::ptrdiff_t>(offset_ + length));
  chunk.length = length;
  chunk.hasData = true;
  chunk.isLast = (offset_ + length) >= firmware_.size();
  return chunk;
}

Progress OtaEngine::confirmChunkWritten(size_t byteLength) {
  offset_ = std::min(offset_ + byteLength, firmware_.size());
  if (phase_ == Phase::Starting) {
    phase_ = Phase::Transferring;
  }
  if (offset_ >= firmware_.size() && !firmware_.empty()) {
    phase_ = Phase::Flushing;
  }
  return progress();
}

Progress OtaEngine::rewindToStart() {
  offset_ = 0;
  bytesConfirmed_ = 0;
  if (phase_ != Phase::Idle) {
    phase_ = Phase::Starting;
  }
  return progress();
}

StatusEvent OtaEngine::parseStatus(const std::vector<uint8_t>& bytes) const {
  StatusEvent event;
  if (bytes.empty()) {
    return event;
  }
  event.rawStatus = bytes[0];

  switch (bytes[0]) {
    case protocol::kStatusReady:
      event.kind = StatusKind::Ready;
      break;
    case protocol::kStatusProgress:
      event.kind = StatusKind::Progress;
      if (bytes.size() >= 5) {
        event.bytesWritten = static_cast<uint32_t>(bytes[1]) |
            (static_cast<uint32_t>(bytes[2]) << 8) |
            (static_cast<uint32_t>(bytes[3]) << 16) |
            (static_cast<uint32_t>(bytes[4]) << 24);
      }
      break;
    case protocol::kStatusError:
      event.kind = StatusKind::Error;
      if (bytes.size() >= 2) {
        event.errorCode = bytes[1];
      }
      break;
    case protocol::kStatusFinished:
      event.kind = StatusKind::Finished;
      break;
    default:
      event.kind = StatusKind::Unknown;
      break;
  }
  return event;
}

Progress OtaEngine::applyStatus(const std::vector<uint8_t>& bytes) {
  const StatusEvent event = parseStatus(bytes);
  switch (event.kind) {
    case StatusKind::Ready:
      if (phase_ == Phase::Starting) {
        phase_ = Phase::Transferring;
      }
      break;
    case StatusKind::Progress:
      bytesConfirmed_ = std::min<size_t>(event.bytesWritten, firmware_.size());
      if (phase_ == Phase::Starting) {
        phase_ = Phase::Transferring;
      }
      break;
    case StatusKind::Finished:
      bytesConfirmed_ = firmware_.size();
      phase_ = Phase::Completed;
      break;
    case StatusKind::Error:
      phase_ = Phase::Failed;
      break;
    case StatusKind::Unknown:
      break;
  }
  return progress();
}

Progress OtaEngine::progress() const {
  Progress p;
  p.phase = phase_;
  p.bytesSent = offset_;
  p.bytesConfirmed = bytesConfirmed_;
  p.totalBytes = firmware_.size();
  p.percent = firmware_.empty()
      ? 0
      : static_cast<int>((bytesConfirmed_ * 100) / firmware_.size());
  return p;
}

bool OtaEngine::isTransferComplete() const {
  return !firmware_.empty() && offset_ >= firmware_.size();
}

bool OtaEngine::isFlashConfirmed() const {
  return !firmware_.empty() && bytesConfirmed_ >= firmware_.size();
}

void OtaEngine::abort() {
  firmware_.clear();
  version_.clear();
  offset_ = 0;
  bytesConfirmed_ = 0;
  chunkSize_ = protocol::kMaxChunkSize;
  phase_ = Phase::Idle;
}

} // namespace gtdev::ota
