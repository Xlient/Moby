Pod::Spec.new do |s|
  s.name           = 'MobyMesh'
  s.version        = '0.1.0'
  s.summary        = "Moby's Bluetooth LE mesh radio (iOS: not implemented yet)"
  s.license        = 'MIT'
  s.author         = 'Moby'
  s.homepage       = 'https://github.com/Xlient/moby'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
