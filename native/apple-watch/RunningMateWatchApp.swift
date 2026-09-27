import SwiftUI
import WatchConnectivity

@main
struct RunningMateWatchApp: App {
  @StateObject private var run = WatchRunStore()
  var body: some Scene { WindowGroup { WatchRunView(run: run) } }
}

/// 워치 화면의 상태.
///
/// 워치는 두 가지로 쓰인다.
/// - **리모컨**: 폰이 러닝을 기록 중이면 폰이 보내는 지표를 비추고 명령만 보낸다.
/// - **단독 기록**: 폰이 러닝 중이 아니면 워치가 직접 GPS를 기록하고, 끝난 뒤
///   폰으로 파일을 넘긴다. 폰이 그 좌표를 서버에 올린다.
///
/// 워치는 서버에 직접 쓰지 않는다. 로그인 세션·동의 판정·원본 좌표 적재는
/// 폰 한 곳에만 둔다.
@MainActor
final class WatchRunStore: NSObject, ObservableObject, WCSessionDelegate {
  /// 폰이 알려 준 상태. 폰이 러닝 중인지 판단하는 근거다.
  @Published var phoneState = "idle"
  @Published var distanceMeters = 0.0
  @Published var elapsedSeconds = 0.0
  @Published var averagePaceSeconds: Double?
  /// 워치가 직접 기록 중일 때만 true.
  @Published var isLocalRun = false
  @Published var isLocalPaused = false
  @Published var pendingTransfers = 0
  @Published var notice: String?

  private let recorder = WatchRunRecorder()

  override init() {
    super.init()
    recorder.delegate = self
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
    apply(session.receivedApplicationContext)

    // 종료를 찍지 못하고 죽은 러닝을 먼저 건져 outbox에 넣는다.
    for payload in WatchRunRecorder.recoverAbandonedRuns() {
      WatchRunTransfer.shared.enqueue(payload)
    }
    refreshPending()
  }

  /// 폰이 러닝 중이라 워치가 리모컨으로 동작해야 하는 상태.
  var isMirroringPhone: Bool { !isLocalRun && phoneState != "idle" }

  // MARK: - 폰 원격 조종

  func command(_ command: String) {
    let session = WCSession.default
    guard session.isReachable else {
      notice = "아이폰에 닿지 않아요."
      return
    }
    session.sendMessage(["command": command], replyHandler: nil) { _ in }
  }

  // MARK: - 워치 단독 기록

  func startLocal() { recorder.start() }
  func pauseLocal() { recorder.pause() }
  func resumeLocal() { recorder.resume() }
  func finishLocal() { recorder.finish() }

  private func refreshPending() { pendingTransfers = WatchRunTransfer.shared.pendingCount }

  // MARK: - WCSessionDelegate

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    Task { @MainActor in
      self.apply(session.receivedApplicationContext)
      WatchRunTransfer.shared.flush()
      self.refreshPending()
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor in self.apply(applicationContext) }
  }

  nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
    Task { @MainActor in
      WatchRunTransfer.shared.didFinish(fileTransfer, error: error)
      self.refreshPending()
      self.notice = error == nil ? "아이폰으로 러닝을 넘겼어요." : "아이폰에 넘기지 못했어요. 다시 시도할게요."
    }
  }

  /// 폰이 보낸 스냅샷을 반영한다. 워치가 직접 기록 중일 때는 화면을 뺏지
  /// 않는다. 두 기록이 동시에 돌면 사용자가 어느 쪽 숫자를 보는지 알 수 없다.
  private func apply(_ context: [String: Any]) {
    guard !context.isEmpty else { return }
    phoneState = context["state"] as? String ?? "idle"
    guard !isLocalRun else { return }
    distanceMeters = context["distanceMeters"] as? Double ?? 0
    elapsedSeconds = context["elapsedSeconds"] as? Double ?? 0
    averagePaceSeconds = context["averagePaceSeconds"] as? Double
  }
}

extension WatchRunStore: WatchRunRecorderDelegate {
  func recorderDidUpdate(distanceMeters: Double, elapsedSeconds: Double, averagePaceSeconds: Double?) {
    isLocalRun = recorder.isRecording || recorder.isPaused
    isLocalPaused = recorder.isPaused
    guard isLocalRun else { return }
    self.distanceMeters = distanceMeters
    self.elapsedSeconds = elapsedSeconds
    self.averagePaceSeconds = averagePaceSeconds
  }

  func recorderDidFinish(_ payload: WatchRunPayload) {
    isLocalRun = false
    isLocalPaused = false
    WatchRunTransfer.shared.enqueue(payload)
    refreshPending()
    notice = payload.points.isEmpty
      ? "좌표를 받지 못해 기록이 비어 있어요."
      : "아이폰으로 넘기는 중이에요."
  }

  func recorderDidFail(_ message: String) { notice = message }
}

struct WatchRunView: View {
  @ObservedObject var run: WatchRunStore

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Text(header).font(.footnote).foregroundStyle(.mint)
        Text(String(format: "%.2f", run.distanceMeters / 1000))
          .font(.system(size: 38, weight: .bold, design: .rounded))
        Text("km").font(.footnote).foregroundStyle(.secondary)
        HStack { metric("시간", duration(run.elapsedSeconds)); metric("평균", pace(run.averagePaceSeconds)) }
        controls
        if run.pendingTransfers > 0 {
          Text("아이폰 대기 \(run.pendingTransfers)건").font(.caption2).foregroundStyle(.orange)
        }
        if let notice = run.notice {
          Text(notice).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
      }.scenePadding()
    }
  }

  private var header: String {
    if run.isLocalPaused { return "워치 기록 일시정지" }
    if run.isLocalRun { return "워치로 기록 중" }
    if run.phoneState == "paused" { return "일시정지" }
    if run.phoneState == "recording" { return "러닝 중" }
    return "같이뛰어"
  }

  @ViewBuilder private var controls: some View {
    if run.isLocalRun {
      if run.isLocalPaused {
        HStack {
          Button("계속") { run.resumeLocal() }.tint(.green)
          Button("종료") { run.finishLocal() }.tint(.red)
        }
      } else {
        HStack {
          Button("일시정지") { run.pauseLocal() }
          Button("종료") { run.finishLocal() }.tint(.red)
        }
      }
    } else if run.isMirroringPhone {
      // 폰이 기록 중이면 폰이 주인이다. 워치는 명령만 보낸다.
      if run.phoneState == "recording" {
        HStack {
          Button("일시정지") { run.command("pause") }
          Button("종료") { run.command("finish") }.tint(.red)
        }
      } else if run.phoneState == "paused" {
        HStack {
          Button("계속") { run.command("resume") }.tint(.green)
          Button("종료") { run.command("finish") }.tint(.red)
        }
      } else {
        ProgressView()
      }
    } else {
      VStack(spacing: 6) {
        Button("워치로 시작") { run.startLocal() }.tint(.green)
        Button("아이폰으로 시작") { run.command("start") }.buttonStyle(.bordered)
      }
    }
  }

  private func metric(_ title: String, _ value: String) -> some View {
    VStack(spacing: 1) {
      Text(value).font(.caption).monospacedDigit()
      Text(title).font(.caption2).foregroundStyle(.secondary)
    }
  }

  private func duration(_ value: Double) -> String {
    let seconds = Int(value)
    return String(format: "%02d:%02d", seconds / 60, seconds % 60)
  }

  private func pace(_ value: Double?) -> String {
    guard let value else { return "--:--" }
    return String(format: "%d:%02d", Int(value) / 60, Int(value) % 60)
  }
}
