#include "NativeLibOTAModule.h"

#include <fstream>
#include <iterator>

#include "Base64.h"

namespace facebook::react {

using gtdev::ota::DataChunk;
using gtdev::ota::OtaEngine;
using gtdev::ota::Progress;
using gtdev::ota::StatusEvent;
namespace protocol = gtdev::ota::protocol;

namespace {

jsi::Value makeString(jsi::Runtime& rt, const char* value) {
  return jsi::String::createFromUtf8(rt, value);
}

// Decodes a Base64 argument or throws a JS error, so transport bugs surface as
// catchable exceptions on the JS side instead of silent corruption.
std::vector<uint8_t> decodeOrThrow(
    jsi::Runtime& rt,
    const std::string& base64,
    const char* argName) {
  std::vector<uint8_t> bytes;
  if (!gtdev::ota::base64Decode(base64, bytes)) {
    throw jsi::JSError(
        rt, std::string("Invalid base64 passed for '") + argName + "'");
  }
  return bytes;
}

// Reads the whole firmware image from disk, or throws a JS error so a missing /
// unreadable path surfaces as a catchable exception on the JS side.
std::vector<uint8_t> readFileOrThrow(
    jsi::Runtime& rt,
    const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    throw jsi::JSError(rt, "Unable to open firmware file: " + path);
  }
  return std::vector<uint8_t>(
      std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

} // namespace

NativeLibOTAModule::NativeLibOTAModule(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeLibOTAModuleCxxSpec(std::move(jsInvoker)) {}

jsi::Object NativeLibOTAModule::getProtocolConfig(jsi::Runtime& rt) {
  jsi::Object config(rt);
  config.setProperty(rt, "deviceName", makeString(rt, protocol::kDeviceName));
  config.setProperty(
      rt, "controlCharUuid", makeString(rt, protocol::kControlCharUuid));
  config.setProperty(
      rt, "dataCharUuid", makeString(rt, protocol::kDataCharUuid));
  config.setProperty(
      rt, "statusCharUuid", makeString(rt, protocol::kStatusCharUuid));
  config.setProperty(
      rt,
      "firmwareRevisionCharUuid",
      makeString(rt, protocol::kFirmwareRevisionCharUuid));
  config.setProperty(
      rt, "versionLength", static_cast<double>(protocol::kVersionLength));
  config.setProperty(rt, "cmdStart", static_cast<double>(protocol::kCmdStart));
  config.setProperty(
      rt, "cmdFinish", static_cast<double>(protocol::kCmdFinish));
  config.setProperty(
      rt, "statusReady", static_cast<double>(protocol::kStatusReady));
  config.setProperty(
      rt, "statusProgress", static_cast<double>(protocol::kStatusProgress));
  config.setProperty(
      rt, "statusError", static_cast<double>(protocol::kStatusError));
  config.setProperty(
      rt, "statusFinished", static_cast<double>(protocol::kStatusFinished));
  config.setProperty(
      rt, "minChunkSize", static_cast<double>(protocol::kMinChunkSize));
  config.setProperty(
      rt, "maxChunkSize", static_cast<double>(protocol::kMaxChunkSize));
  return config;
}

double NativeLibOTAModule::computeChunkSize(jsi::Runtime&, double mtuSize) {
  return static_cast<double>(OtaEngine::computeChunkSize(static_cast<int>(mtuSize)));
}

jsi::Object NativeLibOTAModule::beginSession(
    jsi::Runtime& rt,
    std::string firmwarePath,
    std::string version,
    double mtuSize) {
  std::vector<uint8_t> firmware = readFileOrThrow(rt, firmwarePath);
  const auto info = engine_.beginSession(
      std::move(firmware), std::move(version), static_cast<int>(mtuSize));

  jsi::Object out(rt);
  out.setProperty(rt, "totalBytes", static_cast<double>(info.totalBytes));
  out.setProperty(rt, "chunkSize", static_cast<double>(info.chunkSize));
  out.setProperty(rt, "totalChunks", static_cast<double>(info.totalChunks));
  return out;
}

double NativeLibOTAModule::updateMtu(jsi::Runtime&, double mtuSize) {
  return static_cast<double>(engine_.updateMtu(static_cast<int>(mtuSize)));
}

std::string NativeLibOTAModule::buildStartCommand(jsi::Runtime&) {
  return gtdev::ota::base64Encode(engine_.buildStartCommand());
}

std::string NativeLibOTAModule::buildFinishCommand(jsi::Runtime&) {
  return gtdev::ota::base64Encode(engine_.buildFinishCommand());
}

jsi::Object NativeLibOTAModule::nextChunk(jsi::Runtime& rt) {
  const DataChunk chunk = engine_.nextChunk();
  jsi::Object out(rt);
  out.setProperty(
      rt,
      "payloadBase64",
      jsi::String::createFromUtf8(rt, gtdev::ota::base64Encode(chunk.payload)));
  out.setProperty(rt, "offset", static_cast<double>(chunk.offset));
  out.setProperty(rt, "length", static_cast<double>(chunk.length));
  out.setProperty(rt, "isLast", chunk.isLast);
  out.setProperty(rt, "hasData", chunk.hasData);
  return out;
}

jsi::Object NativeLibOTAModule::confirmChunkWritten(
    jsi::Runtime& rt,
    double byteLength) {
  const Progress progress =
      engine_.confirmChunkWritten(static_cast<size_t>(byteLength));
  return progressToJs(rt, progress);
}

jsi::Object NativeLibOTAModule::rewindToStart(jsi::Runtime& rt) {
  return progressToJs(rt, engine_.rewindToStart());
}

jsi::Object NativeLibOTAModule::parseStatus(
    jsi::Runtime& rt,
    std::string statusBase64) {
  const std::vector<uint8_t> bytes =
      decodeOrThrow(rt, statusBase64, "statusBase64");
  const StatusEvent event = engine_.parseStatus(bytes);

  jsi::Object out(rt);
  out.setProperty(
      rt, "kind", makeString(rt, gtdev::ota::statusKindName(event.kind)));
  out.setProperty(rt, "rawStatus", static_cast<double>(event.rawStatus));
  out.setProperty(rt, "errorCode", static_cast<double>(event.errorCode));
  out.setProperty(rt, "bytesWritten", static_cast<double>(event.bytesWritten));
  return out;
}

jsi::Object NativeLibOTAModule::applyStatus(
    jsi::Runtime& rt,
    std::string statusBase64) {
  const std::vector<uint8_t> bytes =
      decodeOrThrow(rt, statusBase64, "statusBase64");
  return progressToJs(rt, engine_.applyStatus(bytes));
}

jsi::Object NativeLibOTAModule::getProgress(jsi::Runtime& rt) {
  return progressToJs(rt, engine_.progress());
}

bool NativeLibOTAModule::isTransferComplete(jsi::Runtime&) {
  return engine_.isTransferComplete();
}

bool NativeLibOTAModule::isFlashConfirmed(jsi::Runtime&) {
  return engine_.isFlashConfirmed();
}

void NativeLibOTAModule::abortSession(jsi::Runtime&) {
  engine_.abort();
}

jsi::Object NativeLibOTAModule::progressToJs(
    jsi::Runtime& rt,
    const Progress& progress) {
  jsi::Object out(rt);
  out.setProperty(
      rt, "phase", makeString(rt, gtdev::ota::phaseName(progress.phase)));
  out.setProperty(rt, "bytesSent", static_cast<double>(progress.bytesSent));
  out.setProperty(
      rt, "bytesConfirmed", static_cast<double>(progress.bytesConfirmed));
  out.setProperty(rt, "totalBytes", static_cast<double>(progress.totalBytes));
  out.setProperty(rt, "percent", static_cast<double>(progress.percent));
  return out;
}

} // namespace facebook::react
