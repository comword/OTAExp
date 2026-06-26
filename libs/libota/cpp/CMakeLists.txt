cmake_minimum_required(VERSION 3.13)

# `rnota` is the module target name autolinking expects
# (react-native.config.js -> cxxModuleCMakeListsModuleName). It builds ONLY the
# hand-written C++ in cpp/common. The generated JSI spec (cpp/_generated) and the
# Android JNI module provider are compiled by the react_codegen_RTNLibOTA target
# in _codegen_android/CMakeLists.txt, which the app links alongside this one.
# Compiling _generated here too would duplicate those object files at link time.
#
# Guarded so it is safe to include more than once (autolinking adds this module
# via both cmakeListsPath and cxxModuleCMakeListsPath).
if(NOT TARGET rnota)
  file(GLOB rnota_COMMON_SRCS CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/common/*.cpp")

  add_library(rnota STATIC ${rnota_COMMON_SRCS})

  # PUBLIC so the app inherits the include path and can resolve
  # <NativeLibOTAModule.h> from the generated autolinking.cpp. _generated is on
  # the path so NativeLibOTAModule.h can include "RTNLibOTAJSI.h".
  target_include_directories(rnota PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/common"
    "${CMAKE_CURRENT_SOURCE_DIR}/_generated")

  # Alias targets defined by ReactNative-application.cmake before autolinking.
  # These propagate the JSI / TurboModule / fbjni include directories.
  target_link_libraries(rnota
    fbjni
    jsi
    reactnative)

  # RN 0.85's bridging headers (react/bridging/*.h) require C++20 and the folly
  # compile flags. This sets them consistently with every other autolinked
  # target (the manual CMAKE_CXX_STANDARD 17 was the cause of the
  # "unknown type name 'requires'" errors).
  target_compile_reactnative_options(rnota PRIVATE)
endif()
