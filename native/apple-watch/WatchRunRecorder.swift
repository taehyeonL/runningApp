import Foundation
import CoreLocation
import HealthKit

/// 워치가 단독으로 기록한 좌표 하나. 폰의 `StoredRunPoint`와 같은 모양이어야
/// 이관된 뒤 폰의 품질 필터를 그대로 통과할 수 있다.
struct WatchRunPoint: Codable {
  let recordedAt: Double
  let latitude: Double
  let longitude: Double
  let accuracyMeters: Double?
  let altitudeMeters: Double?
  let speedMps: Double?
  let headingDegrees: Double?
}

/// 워치 러닝 한 건. 진행 중에도 같은 구조로 디스크에 남아, 앱이 죽어도
/// 다음 실행에서 복구된다.
struct WatchRunPayload: Codable {
  var version: Int = 1
  let sourceRecordId: String
  let startedAt: Double
  var endedAt: Double?
  var totalPausedMs: Double
  var recovered: Bool
  var points: [WatchRunPoint]
}

/// 워치 러닝 파일이 사는 곳.
///
/// - `journal/`  기록 중인 러닝. 정상 종료하면 지운다.
/// - `outbox/`   폰으로 넘길 러닝. 폰이 받았다고 확인해 줄 때까지 남긴다.
enum WatchRunFiles {
  static func directory(_ name: String) -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("WatchRuns", isDirectory: true)
      .appendingPathComponent(name, isDirectory: true)
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  static func write(_ payload: WatchRunPayload, into folder: String) -> URL? {
    let url = directory(folder).appendingPathComponent("\(payload.sourceRecordId).json")
    guard let data = try? JSONEncoder().encode(payload) else { return nil }
    do { try data.write(to: url, options: .atomic) } catch { return nil }
    return url
  }

  static func load(_ url: URL) -> WatchRunPayload? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(WatchRunPayload.self, from: data)
  }

  static func contents(of folder: String) -> [URL] {
    let urls = try? FileManager.default.contentsOfDirectory(
      at: directory(folder), includingPropertiesForKeys: nil)
    return (urls ?? []).filter { $0.pathExtension == "json" }
  }
}

@MainActor
protocol WatchRunRecorderDelegate: AnyObject {
  func recorderDidUpdate(distanceMeters: Double, elapsedSeconds: Double, averagePaceSeconds: Double?)
  func recorderDidFinish(_ payload: WatchRunPayload)
  func recorderDidFail(_ message: String)
}

/// 폰 없이 워치만으로 러닝을 기록한다.
///
/// watchOS는 활성 `HKWorkoutSession` 없이는 앱이 백그라운드로 내려가는 순간
/// 위치 업데이트를 끊는다. 그래서 심박·칼로리를 쓰지 않더라도 운동 세션을
/// 반드시 연다. 심박은 별도 동의(`health_data`)가 필요한데 아직 받지 않으므로
/// **읽지도, 넘기지도 않는다.**
@MainActor
final class WatchRunRecorder: NSObject {
  weak var delegate: WatchRunRecorderDelegate?

  private let healthStore = HKHealthStore()
  private let locationManager = CLLocationManager()
  private var workoutSession: HKWorkoutSession?

  private var payload: WatchRunPayload?
  private var pausedAt: Double?
  private var pointsSinceJournal = 0

  // 누적 지표. 폰이 이관 시점에 같은 필터로 다시 계산하므로 여기 값은
  // 워치 화면 표시 전용이다. 서버로 가는 숫자는 폰이 정한다.
  private var distanceMeters = 0.0
  private var movingMs = 0.0
  private var lastAccepted: WatchRunPoint?

  private static let maxAccuracyMeters = 30.0
  private static let maxSpeedMps = 12.0
  private static let maxSegmentSeconds = 120.0
  private static let journalEveryPoints = 5

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    locationManager.activityType = .fitness
    locationManager.distanceFilter = 5
    locationManager.allowsBackgroundLocationUpdates = true
  }

  var isRecording: Bool { payload != nil && pausedAt == nil }
  var isPaused: Bool { payload != nil && pausedAt != nil }

  // MARK: - 수명주기

  func start() {
    guard payload == nil else { return }
    guard CLLocationManager.locationServicesEnabled() else {
      delegate?.recorderDidFail("위치 서비스를 켜 주세요.")
      return
    }
    locationManager.requestWhenInUseAuthorization()

    let started = Date().timeIntervalSince1970 * 1000
    let suffix = String(UUID().uuidString.prefix(8)).lowercased()
    payload = WatchRunPayload(
      sourceRecordId: "watch-\(Int(started))-\(suffix)",
      startedAt: started,
      endedAt: nil,
      totalPausedMs: 0,
      recovered: false,
      points: [])
    distanceMeters = 0
    movingMs = 0
    lastAccepted = nil
    pausedAt = nil

    beginWorkout()
    locationManager.startUpdatingLocation()
    journal(force: true)
    publish()
  }

  func pause() {
    guard payload != nil, pausedAt == nil else { return }
    pausedAt = Date().timeIntervalSince1970 * 1000
    locationManager.stopUpdatingLocation()
    workoutSession?.pause()
    // 재개하면 좌표가 끊긴 지점부터 다시 이어지므로, 그 사이를 직선으로
    // 잇지 않도록 마지막 기준점을 버린다.
    lastAccepted = nil
    journal(force: true)
    publish()
  }

  func resume() {
    guard payload != nil, let paused = pausedAt else { return }
    payload?.totalPausedMs += Date().timeIntervalSince1970 * 1000 - paused
    pausedAt = nil
    workoutSession?.resume()
    locationManager.startUpdatingLocation()
    journal(force: true)
    publish()
  }

  func finish() {
    guard var current = payload else { return }
    if let paused = pausedAt {
      current.totalPausedMs += Date().timeIntervalSince1970 * 1000 - paused
    }
    current.endedAt = Date().timeIntervalSince1970 * 1000
    pausedAt = nil
    payload = nil

    locationManager.stopUpdatingLocation()
    endWorkout()
    clearJournal(current.sourceRecordId)
    delegate?.recorderDidFinish(current)
    publish()
  }

  func discard() {
    guard let current = payload else { return }
    payload = nil
    pausedAt = nil
    locationManager.stopUpdatingLocation()
    endWorkout()
    clearJournal(current.sourceRecordId)
    publish()
  }

  /// 앱이 종료를 찍지 못하고 죽은 러닝을 되살린다. 마지막 좌표 시각을 종료로
  /// 삼고 `recovered`를 세워, 폰이 사용자에게 그대로 알릴 수 있게 한다.
  static func recoverAbandonedRuns() -> [WatchRunPayload] {
    var recovered: [WatchRunPayload] = []
    for url in WatchRunFiles.contents(of: "journal") {
      guard var payload = WatchRunFiles.load(url) else {
        try? FileManager.default.removeItem(at: url)
        continue
      }
      try? FileManager.default.removeItem(at: url)
      guard let last = payload.points.last else { continue }
      payload.endedAt = last.recordedAt
      payload.recovered = true
      recovered.append(payload)
    }
    return recovered
  }

  // MARK: - 운동 세션

  private func beginWorkout() {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    // 백그라운드 실행 권한을 얻는 최소한만 요청한다. 읽기 권한은 요청하지 않는다.
    let workoutType = HKObjectType.workoutType()
    healthStore.requestAuthorization(toShare: [workoutType], read: []) { [weak self] _, _ in
      Task { @MainActor in self?.startWorkoutSession() }
    }
  }

  private func startWorkoutSession() {
    guard workoutSession == nil, payload != nil else { return }
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .running
    configuration.locationType = .outdoor
    do {
      let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
      session.startActivity(with: Date())
      workoutSession = session
    } catch {
      // 운동 세션이 없으면 화면이 꺼졌을 때 좌표가 끊긴다. 기록 자체는
      // 이어 가되 사용자에게 이유를 알린다.
      delegate?.recorderDidFail("화면이 꺼지면 기록이 멈출 수 있어요.")
    }
  }

  private func endWorkout() {
    workoutSession?.end()
    workoutSession = nil
  }

  // MARK: - 좌표 누적

  private func accept(_ location: CLLocation) {
    guard payload != nil, pausedAt == nil else { return }
    let recordedAt = location.timestamp.timeIntervalSince1970 * 1000
    guard recordedAt >= (payload?.startedAt ?? 0) else { return }
    if let latest = payload?.points.last, recordedAt <= latest.recordedAt { return }

    let accuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
    let point = WatchRunPoint(
      recordedAt: recordedAt,
      latitude: location.coordinate.latitude,
      longitude: location.coordinate.longitude,
      accuracyMeters: accuracy,
      altitudeMeters: location.verticalAccuracy >= 0 ? location.altitude : nil,
      speedMps: location.speed >= 0 ? location.speed : nil,
      headingDegrees: location.course >= 0 ? location.course : nil)

    // 폰이 버릴 점도 그대로 넘긴다. 최종 판정은 폰의 필터 한 곳에서만 한다.
    payload?.points.append(point)
    updateMetrics(with: point)

    pointsSinceJournal += 1
    journal(force: false)
    publish()
  }

  /// 워치 화면에 띄울 잠정 지표. 폰의 `accumulateRunPoint`와 같은 임계값을
  /// 쓰지만, 서버로 가는 값은 이관 뒤 폰이 다시 계산한 결과다.
  private func updateMetrics(with point: WatchRunPoint) {
    guard let accuracy = point.accuracyMeters, accuracy <= Self.maxAccuracyMeters else { return }
    guard let previous = lastAccepted else {
      lastAccepted = point
      return
    }
    let elapsedSeconds = (point.recordedAt - previous.recordedAt) / 1000
    let distance = CLLocation(latitude: previous.latitude, longitude: previous.longitude)
      .distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude))
    let implied = elapsedSeconds > 0 ? distance / elapsedSeconds : .infinity
    if elapsedSeconds <= 0 || elapsedSeconds > Self.maxSegmentSeconds || implied > Self.maxSpeedMps {
      return
    }
    distanceMeters += distance
    if distance >= 1 || (point.speedMps ?? 0) >= 0.3 { movingMs += elapsedSeconds * 1000 }
    lastAccepted = point
  }

  private func publish() {
    guard let current = payload else {
      delegate?.recorderDidUpdate(distanceMeters: 0, elapsedSeconds: 0, averagePaceSeconds: nil)
      return
    }
    let end = pausedAt ?? Date().timeIntervalSince1970 * 1000
    let elapsed = max(0, (end - current.startedAt - current.totalPausedMs) / 1000)
    var pace: Double?
    if distanceMeters >= 100 {
      let candidate = (movingMs / 1000) / (distanceMeters / 1000)
      if candidate >= 60 && candidate <= 7200 { pace = candidate }
    }
    delegate?.recorderDidUpdate(
      distanceMeters: distanceMeters, elapsedSeconds: elapsed, averagePaceSeconds: pace)
  }

  // MARK: - 저널

  private func journal(force: Bool) {
    guard let current = payload else { return }
    if !force && pointsSinceJournal < Self.journalEveryPoints { return }
    pointsSinceJournal = 0
    _ = WatchRunFiles.write(current, into: "journal")
  }

  private func clearJournal(_ sourceRecordId: String) {
    let url = WatchRunFiles.directory("journal").appendingPathComponent("\(sourceRecordId).json")
    try? FileManager.default.removeItem(at: url)
  }
}

extension WatchRunRecorder: CLLocationManagerDelegate {
  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    Task { @MainActor in
      for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) { self.accept(location) }
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    Task { @MainActor in self.delegate?.recorderDidFail("위치를 받지 못했어요.") }
  }
}
