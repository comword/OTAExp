// Declares @gtdev/rtn-libgp as a pure C++ Turbo Native Module so the React
// Native CLI autolinks it on Android without any Java/Kotlin/JNI scaffolding.
// `sourceDir: cpp` has no build.gradle / AndroidManifest.xml, which is how the
// CLI recognizes a pure-C++ dependency.
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'cpp',
        cxxModuleCMakeListsModuleName: 'rnota',
        // Resolved relative to sourceDir (cpp), i.e. cpp/CMakeLists.txt.
        cxxModuleCMakeListsPath: 'CMakeLists.txt',
        cxxModuleHeaderName: 'NativeLibOTAModule',
        // As a pure C++ module there is no Android Gradle project, so the RN
        // Gradle plugin never runs codegen for us and the default
        // cpp/build/generated/source/codegen/jni path is never produced. Point
        // autolinking at our committed Android codegen wrapper instead, which
        // builds the shared JSI spec (cpp/_generated) plus the JNI module
        // provider. Resolved relative to sourceDir (cpp).
        cmakeListsPath: '_codegen_android/CMakeLists.txt',
      },
      ios: {},
    },
  },
};
