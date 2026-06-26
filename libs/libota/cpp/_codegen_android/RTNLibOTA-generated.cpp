#include "RTNLibOTA.h"

namespace facebook::react {

// RTNLibGP is a pure C++ Turbo Native Module: there is no Java-backed module to
// vend here. Declining lets React Native fall through to the C++ provider
// (autolinking_cxxModuleProvider), which constructs NativeLibGPModule.
std::shared_ptr<TurboModule> RTNLibOTA_ModuleProvider(
    const std::string& /*moduleName*/,
    const JavaTurboModule::InitParams& /*params*/) {
  return nullptr;
}

}  // namespace facebook::react
