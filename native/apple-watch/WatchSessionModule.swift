import Foundation
import React
import WatchConnectivity

@objc(WatchSession)
final class WatchSessionModule: RCTEventEmitter, WCSessionDelegate {
  private var hasListeners = false

  /// 워치가 넘긴 러닝 파일이 쌓이는 곳.
  ///
  /// 여기 있는 파일은 **원본 GPS**다. `location_points`와 같은 취급을 받아야
  /// 하므로 iCloud 백업에서 제외하고, 서버 적재가 끝나면 JS가 지운다.
  private static func inboxDirectory() -> URL {
    var url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("WatchRuns", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    try? url.setResourceValues(resourceValues)
    return url
  }

  /// 워치가 준 식별자를 파일 이름으로 쓰기 전에 좁힌다. 워치는 우리 코드지만
  /// 경로를 만드는 값을 그대로 믿지 않는다.
  private static func safeName(_ value: String) -> String? {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")
    let filtered = String(value.unicodeScalars.filter { allowed.contains($0) })
    return filtered.count >= 1 && filtered.count <= 128 ? filtered : nil
  }

  override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  @objc override static func requiresMainQueueSetup() -> Bool { true }
  override func supportedEvents() -> [String]! { ["WatchSessionCommand", "WatchRunReceived"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func updateRun(_ snapshot: NSDictionary) {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    do { try WCSession.default.updateApplicationContext(snapshot as! [String: Any]) }
    catch { NSLog("Watch session context update failed: %@", error.localizedDescription) }
  }

  /// 아직 서버에 올리지 못한 워치 러닝을 JSON 문자열로 돌려준다.
  ///
  /// 앱이 꺼져 있는 동안 배달된 파일도 여기서 잡힌다. iOS가 파일 도착 때
  /// 앱을 깨우지만 JS 리스너가 그때 살아 있다는 보장이 없어, 이벤트가 아니라
  /// 디스크를 진실로 삼는다.
  @objc func pendingWatchRuns(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let directory = Self.inboxDirectory()
    let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    var payloads: [String] = []
    for url in urls where url.pathExtension == "json" {
      guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
        try? FileManager.default.removeItem(at: url)
        continue
      }
      payloads.append(text)
    }
    resolve(payloads)
  }

  /// 서버 적재가 끝난 러닝을 지운다. 적재 전에는 절대 부르지 않는다.
  @objc func clearWatchRun(
    _ sourceRecordId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let name = Self.safeName(sourceRecordId) else {
      resolve(false)
      return
    }
    let url = Self.inboxDirectory().appendingPathComponent("\(name).json")
    try? FileManager.default.removeItem(at: url)
    resolve(true)
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if let error { NSLog("Watch session activation failed: %@", error.localizedDescription) }
  }
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    guard let command = message["command"] as? String,
          ["start", "pause", "resume", "finish"].contains(command) else { return }
    DispatchQueue.main.async { [weak self] in
      guard self?.hasListeners == true else { return }
      self?.sendEvent(withName: "WatchSessionCommand", body: command)
    }
  }

  /// 워치가 넘긴 러닝 파일을 받는다.
  ///
  /// iOS는 이 메서드가 반환하는 순간 inbox의 원본을 지운다. 비동기로 옮기면
  /// 파일이 사라진 뒤에 복사하게 되므로 **여기서 동기적으로** 꺼내 온다.
  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    let fallback = file.fileURL.deletingPathExtension().lastPathComponent
    let identifier = (file.metadata?["sourceRecordId"] as? String) ?? fallback
    guard let name = Self.safeName(identifier) else {
      NSLog("Watch run rejected: unusable source record id")
      return
    }

    let destination = Self.inboxDirectory().appendingPathComponent("\(name).json")
    do {
      // 같은 러닝이 다시 배달될 수 있다. 마지막 것으로 덮어쓰면 되고,
      // 서버 쪽은 source_record_id 유니크 제약이 중복을 막는다.
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.copyItem(at: file.fileURL, to: destination)
    } catch {
      NSLog("Watch run copy failed: %@", error.localizedDescription)
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard self?.hasListeners == true else { return }
      self?.sendEvent(withName: "WatchRunReceived", body: name)
    }
  }
}
