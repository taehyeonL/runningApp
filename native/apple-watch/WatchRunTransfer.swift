import Foundation
import WatchConnectivity

/// 워치가 기록한 러닝을 폰으로 넘긴다.
///
/// `sendMessage`는 폰이 깨어 있을 때만 닿고 실패하면 사라진다. 러닝 한 건은
/// 다시 만들 수 없으므로 `transferFile`을 쓴다. 이 큐는 watchOS가 관리해서
/// 앱이 꺼져 있어도, 폰이 나중에 켜져도 배달된다.
///
/// 배달이 끝났다고 확인되기 전에는 outbox의 파일을 지우지 않는다. 지우고 나서
/// 실패를 확인하면 그 러닝은 영영 사라진다.
@MainActor
final class WatchRunTransfer {
  static let shared = WatchRunTransfer()

  /// 진행 중인 전송의 파일 경로. `didFinish`에서 성공한 것만 지우기 위해 둔다.
  private var inFlight: [String: URL] = [:]

  private init() {}

  /// 폰에 아직 넘기지 못한 러닝 수.
  var pendingCount: Int { WatchRunFiles.contents(of: "outbox").count }

  func enqueue(_ payload: WatchRunPayload) {
    _ = WatchRunFiles.write(payload, into: "outbox")
    flush()
  }

  /// outbox에 남은 것을 모두 다시 밀어 넣는다. 앱 실행 때와 세션이 활성화될
  /// 때마다 부른다.
  func flush() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }

    // watchOS가 이미 들고 있는 전송은 다시 걸지 않는다. 같은 러닝을 두 번
    // 보내도 폰이 sourceRecordId로 합치지만, 큐를 불리는 이유는 없다.
    let queued = Set(session.outstandingFileTransfers.compactMap {
      $0.file.metadata?["sourceRecordId"] as? String
    })

    for url in WatchRunFiles.contents(of: "outbox") {
      let sourceRecordId = url.deletingPathExtension().lastPathComponent
      if queued.contains(sourceRecordId) { continue }
      inFlight[sourceRecordId] = url
      session.transferFile(url, metadata: ["sourceRecordId": sourceRecordId])
    }
  }

  /// `WCSessionDelegate.session(_:didFinish:error:)`에서 넘겨준다.
  func didFinish(_ transfer: WCSessionFileTransfer, error: Error?) {
    guard let sourceRecordId = transfer.file.metadata?["sourceRecordId"] as? String else { return }
    guard error == nil else {
      // 실패한 파일은 outbox에 남는다. 다음 flush에서 다시 시도한다.
      inFlight.removeValue(forKey: sourceRecordId)
      return
    }
    if let url = inFlight.removeValue(forKey: sourceRecordId) {
      try? FileManager.default.removeItem(at: url)
    } else {
      let url = WatchRunFiles.directory("outbox").appendingPathComponent("\(sourceRecordId).json")
      try? FileManager.default.removeItem(at: url)
    }
  }
}
