# Android-only codegen wrapper for the pure C++ Turbo Native Module.
#
# As a pure C++ module there is no Android Gradle project, so the React Native
# Gradle plugin never runs codegen for us and the default
# cpp/build/generated/source/codegen/jni/CMakeLists.txt is never produced.
# react-native.config.js points autolinking's `cmakeListsPath` here instead.
#
# This target compiles:
#   - the cross-platform JSI spec committed in ../_generated (same files iOS
#     consumes via LibGPModule.podspec), and
#   - the Android JNI module-provider shim in this directory (RTNLibGP.h /
#     RTNLibGP-generated.cpp), which the generated autolinking.cpp references.
cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

file(GLOB react_codegen_SRCS CONFIGURE_DEPENDS
  ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../_generated/*.cpp
)

add_library(
  react_codegen_RTNLibOTA
  OBJECT
  ${react_codegen_SRCS}
)

# PUBLIC so consumers (the app's autolinking.cpp and the `rngp` module target)
# inherit the include paths and can resolve <RTNLibGP.h> and "RTNLibGPJSI.h".
target_include_directories(react_codegen_RTNLibOTA PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../_generated
)

target_link_libraries(
  react_codegen_RTNLibOTA
  fbjni
  jsi
  reactnative
)

target_compile_reactnative_options(react_codegen_RTNLibOTA PRIVATE)
