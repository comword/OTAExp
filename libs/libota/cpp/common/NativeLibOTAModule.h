#pragma once

#if __has_include(<RTNLibOTAJSI.h>)
#include <RTNLibOTAJSI.h>
#else
#include "RTNLibOTAJSI.h"
#endif

#include <memory>
#include <string>

#include "OtaEngine.h"

namespace facebook::react {

// Pure C++ Turbo Native Module exposing the BLE OTA algorithm to JS. It is a
// thin JSI adapter over gtdev::ota::OtaEngine: it converts Base64 payloads and
// primitives to/from JSI and otherwise delegates every decision to the engine.
class NativeLibOTAModule
    : public NativeLibOTAModuleCxxSpec<NativeLibOTAModule> {
 public:
  explicit NativeLibOTAModule(std::shared_ptr<CallInvoker> jsInvoker);

  jsi::Object getProtocolConfig(jsi::Runtime& rt);

  double computeChunkSize(jsi::Runtime& rt, double mtuSize);

  jsi::Object beginSession(
      jsi::Runtime& rt,
      std::string firmwarePath,
      std::string version,
      double mtuSize);

  double updateMtu(jsi::Runtime& rt, double mtuSize);

  std::string buildStartCommand(jsi::Runtime& rt);
  std::string buildFinishCommand(jsi::Runtime& rt);

  jsi::Object nextChunk(jsi::Runtime& rt);
  jsi::Object confirmChunkWritten(jsi::Runtime& rt, double byteLength);
  jsi::Object rewindToStart(jsi::Runtime& rt);

  jsi::Object parseStatus(jsi::Runtime& rt, std::string statusBase64);
  jsi::Object applyStatus(jsi::Runtime& rt, std::string statusBase64);

  jsi::Object getProgress(jsi::Runtime& rt);
  bool isTransferComplete(jsi::Runtime& rt);
  bool isFlashConfirmed(jsi::Runtime& rt);
  void abortSession(jsi::Runtime& rt);

 private:
  jsi::Object progressToJs(jsi::Runtime& rt, const gtdev::ota::Progress& progress);

  gtdev::ota::OtaEngine engine_;
};

} // namespace facebook::react
