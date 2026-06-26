require "json"

package = JSON.parse(File.read(File.join(__dir__, "./package.json")))

Pod::Spec.new do |s|
  s.name            = "LibOTAModule"
  s.version         = package["version"]
  s.summary         = package["description"]
  s.description     = package["description"]
  s.homepage        = package["homepage"]
  s.license         = package["license"]
  s.platforms       = { :ios => "12.4" }
  s.author          = package["author"]
  repository = package["repository"]
  repository = repository["url"] if repository.is_a?(Hash)
  s.source          = { :git => repository, :tag => "#{s.version}" }
  # s.user_target_xcconfig = {
  #   'OTHER_LDFLAGS': '-weak_framework CoreNFC',
  # }
  s.default_subspec        = "iosSpec"

  s.subspec "cppCommon" do |ss|
    ss.source_files = "cpp/_generated/*.{h,cpp}", "cpp/common/*.{h,hpp,m,mm,swift,cpp}"
    ss.dependency "React-NativeModulesApple"
    ss.dependency "ReactCommon/turbomodule/core"
    ss.pod_target_xcconfig = {
      "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
    }
  end

  s.subspec "iosSpec" do |ss|
    ss.source_files = "ios/**/*.{h,hpp,m,mm,swift,cpp}"
    ss.pod_target_xcconfig = {
      "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
    }
    install_modules_dependencies(ss)
    ss.dependency "LibOTAModule/cppCommon"
    ss.dependency "React-NativeModulesApple"
    ss.dependency "ReactCommon/turbomodule/core"
  end

end
