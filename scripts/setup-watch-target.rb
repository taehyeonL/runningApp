#!/usr/bin/env ruby
# Adds the native watchOS companion target to Expo's generated iOS project.
# Re-run after `npx expo prebuild --clean`, which recreates ios/app.xcodeproj.
#
# 워치 앱은 **단일 타깃**이다. 예전에는 watchOS UI를 WatchKit 확장에 두는
# 2타깃 구조(watch2_app + watch2_extension)를 만들었는데, Apple이 2023년부터
# 그 구조의 신규 제출을 받지 않고 최신 watchOS는 설치도 거부한다
# (`this app could not be installed at this time`). 아래 로직은 남아 있는
# 옛 타깃을 지우고 단일 타깃으로 다시 만든다.

require 'xcodeproj'
require 'fileutils'

WATCH_SOURCES = ['RunningMateWatchApp.swift', 'WatchRunRecorder.swift', 'WatchRunTransfer.swift'].freeze
HOST_SOURCES = ['WatchSessionModule.swift', 'WatchSessionModuleBridge.m'].freeze
WATCH_TARGET = 'RunningMateWatch'
LEGACY_EXTENSION_TARGET = 'RunningMateWatchExtension'
WATCH_BUNDLE_ID = 'com.lth3723.runningmate.watchkitapp'
TEAM_ID = 'BA92679J95'

root_path = File.expand_path('..', __dir__)
template_path = File.join(root_path, 'native', 'apple-watch')
ios_path = File.join(root_path, 'ios')

FileUtils.mkdir_p(File.join(ios_path, 'app'))
FileUtils.mkdir_p(File.join(ios_path, WATCH_TARGET))
# 2타깃 시절의 잔재. 남겨 두면 다음 실행에서 다시 주워 담는다.
FileUtils.rm_rf(File.join(ios_path, LEGACY_EXTENSION_TARGET))

HOST_SOURCES.each do |name|
  FileUtils.cp(File.join(template_path, name), File.join(ios_path, 'app', name))
end
WATCH_SOURCES.each do |name|
  FileUtils.cp(File.join(template_path, name), File.join(ios_path, WATCH_TARGET, name))
end
FileUtils.cp(File.join(template_path, 'WatchApp-Info.plist'), File.join(ios_path, WATCH_TARGET, 'Info.plist'))
FileUtils.cp(
  File.join(template_path, 'WatchApp.entitlements'),
  File.join(ios_path, WATCH_TARGET, "#{WATCH_TARGET}.entitlements"),
)

project_path = File.join(ios_path, 'app.xcodeproj')
project = Xcodeproj::Project.open(project_path)
host = project.targets.find { |target| target.name == 'app' }
abort 'iOS app target was not found.' unless host

# 타깃 하나를 프로젝트에서 완전히 떼어 낸다. product reference만 지우면
# 임베드 단계에 죽은 파일 참조가 남아 다음 빌드가 깨진다.
def detach_target(project, host, target)
  return unless target

  project.targets.each do |other|
    other.dependencies.select { |dependency| dependency.target == target }.each(&:remove_from_project)
  end
  (host.copy_files_build_phases + project.targets.flat_map(&:copy_files_build_phases)).uniq.each do |phase|
    phase.files.select { |file| file.file_ref == target.product_reference }.each(&:remove_from_project)
  end
  target.product_reference&.remove_from_project
  target.remove_from_project
end

detach_target(project, host, project.targets.find { |target| target.name == LEGACY_EXTENSION_TARGET })

watch = project.targets.find { |target| target.name == WATCH_TARGET }
# 옛 구조에서 만들어진 워치 앱은 product type이 watch2_app이다. 단일 타깃은
# 평범한 application이어야 하므로, 다르면 지우고 다시 만든다.
if watch && watch.product_type != 'com.apple.product-type.application'
  detach_target(project, host, watch)
  watch = nil
end

unless watch
  watch = project.new_target(:application, WATCH_TARGET, :watchos, '10.0')
  host.add_dependency(watch)
end

embed = host.copy_files_build_phases.find { |phase| phase.name == 'Embed Watch Content' } ||
        host.new_copy_files_build_phase('Embed Watch Content')
embed.symbol_dst_subfolder_spec = :wrapper
embed.dst_path = 'Watch'
unless embed.files_references.include?(watch.product_reference)
  embed.add_file_reference(watch.product_reference)
end

watch_group = project.main_group.find_subpath(WATCH_TARGET, true)
WATCH_SOURCES.each do |name|
  path = "#{WATCH_TARGET}/#{name}"
  source = watch_group.files.find { |file| file.path == path } || watch_group.new_file(path)
  watch.add_file_references([source]) unless watch.source_build_phase.files_references.include?(source)
end

watch.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = WATCH_BUNDLE_ID
  settings['INFOPLIST_FILE'] = "#{WATCH_TARGET}/Info.plist"
  settings['PRODUCT_NAME'] = WATCH_TARGET
  settings['MARKETING_VERSION'] = '1.0.0'
  settings['CURRENT_PROJECT_VERSION'] = '1'
  settings['DEVELOPMENT_TEAM'] = TEAM_ID
  settings['SDKROOT'] = 'watchos'
  settings['WATCHOS_DEPLOYMENT_TARGET'] = '10.0'
  settings['SUPPORTED_PLATFORMS'] = 'watchos watchsimulator'
  settings['SWIFT_VERSION'] = '5.0'
  settings['TARGETED_DEVICE_FAMILY'] = '4'
  settings['CODE_SIGN_STYLE'] = 'Automatic'
  settings['GENERATE_INFOPLIST_FILE'] = 'NO'
  settings['SKIP_INSTALL'] = 'YES'
  # 워치 단독 기록은 활성 운동 세션 없이는 화면이 꺼진 뒤 좌표가 끊긴다.
  settings['CODE_SIGN_ENTITLEMENTS'] = "#{WATCH_TARGET}/#{WATCH_TARGET}.entitlements"
end

app_group = project.groups.find { |group| group.display_name == 'app' }
abort 'iOS app source group was not found.' unless app_group

HOST_SOURCES.each do |name|
  file = app_group.files.find { |candidate| candidate.path == "app/#{name}" } || app_group.new_file("app/#{name}")
  host.add_file_references([file]) unless host.source_build_phase.files_references.include?(file)
end

project.save
