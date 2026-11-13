import SwiftUI

/// 待合。部屋のコードと QR、参加者を見せる。ホストだけが難易度を選び、「スタート」を押せる。
/// 参加者には、スタートの所に走る人と「ホストのスタートを待っています」を出す。
/// 選んだシーンは参加者には見せない（ラウンドが始まると全員の画面に出る）。
/// スタートのあと部屋が場面を AI で作っている間は、全員の画面で選ぶ所が走る人に替わる。退出はそのまま押せる。
/// ホストは「他のルーム」から、ほかの人の部屋に移れる（参加者には出さない。× で出てから入り直す）。
/// 苦手の場面で練習する部屋（session.practice）では、ホストに難易度の代わりに苦手の場面の名前を出し、スタートでその場面を始める
struct LobbyView: View {
  let session: RoomSession
  let onLeave: () -> Void
  /// code の部屋に移る（入れてから今の部屋を抜ける）。入れたら新しい部屋の待合に替わる。入れないと投げる（今の部屋のまま）
  var onMove: (String) async throws -> Void = { _ in }
  /// 難易度ごとの例の場面（出題はしない）。Mock も Live も同梱の作り置きの一覧から出す（バックエンドは呼ばない）
  var example: (SceneDifficulty) -> String? = { ScenePool.bundled.example(of: $0) }

  /// ホストが選んだ難易度
  @State private var difficulty = SceneDifficulty.eiken3
  /// 「他のルーム」のシートの状態
  @State private var flow = OtherRoomFlow()

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        CircleIconButton(systemName: "xmark", label: "退出", action: onLeave)
        Spacer()
      }
      .padding(.top, 8)

      // 退出とスタートは上下に固定し、収まらないときは間だけをスクロールする（退出がステータスバーに潜らないように）
      ScrollView {
        VStack(spacing: 0) {
          ticket
            .padding(.top, 10)
          seats
            .padding(.top, 16)
          if session.isGenerating {
            SceneGenerating()
              .padding(.top, 16)
              .transition(.opacity)
          } else if session.isHost, let practice = session.practice {
            PracticeScene(scene: practice)
              .padding(.top, 16)
          } else if session.isHost {
            DifficultyPicker(selected: $difficulty, example: example(difficulty))
              .padding(.top, 16)
          }
        }
        .animation(.easeInOut(duration: 0.3), value: session.isGenerating)
        // カードの影が切れないよう、スクロールの枠だけ左右に広げる
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
      }
      .padding(.horizontal, -16)
      .scrollBounceBehavior(.basedOnSize)
      .scrollIndicators(.hidden)

      if session.isHost {
        // 場面を作っている間は押せない（2 度押さないように）
        Button("スタート") {
          if session.practice != nil {
            session.startPractice()
          } else {
            session.start(difficulty: difficulty)
          }
        }
        .buttonStyle(BigButtonStyle(kind: .primary))
        .disabled(session.isGenerating)
        .padding(.bottom, 30)
      } else {
        // 場面を作っている間は、真ん中に大きな走る人が出るので、下の走る人は消して一言だけにする
        HostWaiting(showsRunner: !session.isGenerating)
          .padding(.bottom, 30)
      }
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
    .sheet(isPresented: Binding(get: { flow.sheetOpen }, set: { if !$0 { flow.close() } })) {
      JoinRoomSheet(
        ticket: flow.ticket,
        step: { session.step(for: $0) },
        move: { code, ticket in
          // いま開いているシートからだけ移る（閉じたシートの古い操作では移らない）。
          // 受け付けないときは投げ、シートが失敗として扱ってコードを消す（打ち直せるように）
          guard flow.accepts(ticket) else { throw RoomSession.MoveError.sheetClosed }
          try await onMove(code)
        }
      )
      // 開き直したシートは、前のシートの状態（打ちかけのコード・確かめの途中）を持ち越さない
      .id(flow.ticket)
      .presentationDetents([.height(640)])
      .presentationDragIndicator(.visible)
      .presentationCornerRadius(32)
      .presentationBackground(Theme.background)
    }
  }

  /// 部屋のコードと QR。ホストには、その下に「他のルーム」を並べる
  private var ticket: some View {
    VStack(spacing: 0) {
      codeAndQR
      if session.isHost {
        Rectangle()
          .fill(Theme.line)
          .frame(height: 2)
          .padding(.horizontal, 16)
        otherRoom
      }
    }
    .background(CardBackground())
  }

  /// 「他のルーム」。押すと、QR を読むかコードを打つシートを開く。場面を作っている間は押せない
  private var otherRoom: some View {
    Button {
      flow.open()
    } label: {
      HStack(spacing: 14) {
        Image(systemName: "qrcode.viewfinder")
          .font(.system(size: 26, weight: .bold))
          .foregroundStyle(session.isGenerating ? Theme.gray : Theme.accent)
        Text("他のルーム")
          .font(Theme.font(19, .heavy))
          .foregroundStyle(session.isGenerating ? Theme.gray : Theme.ink)
        Spacer(minLength: 8)
        Image(systemName: "chevron.right")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(Theme.gray)
      }
      .padding(.horizontal, 18)
      .frame(height: 60)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(session.isGenerating)
    .accessibilityLabel("他のルーム")
  }

  private var codeAndQR: some View {
    let code = session.code ?? "----"
    return HStack(spacing: 0) {
      Text(code)
        .font(Theme.font(56, .black))
        .monospacedDigit()
        .tracking(4)
        .foregroundStyle(Theme.accent)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("部屋のコード \(code)")
      Rectangle()
        .fill(Theme.line)
        .frame(width: 2)
        .padding(.vertical, 14)
      RoomQRCode(text: RoomLink.url(code: code))
        .frame(width: 112, height: 112)
        .padding(16)
    }
    .fixedSize(horizontal: false, vertical: true)
  }

  /// 参加者を席のように 1 列に並べる。空いた席は点線。収まらない分は横にスクロールする
  private var seats: some View {
    let members = session.participants
    return ScrollView(.horizontal) {
      HStack(spacing: 6) {
        ForEach(0..<RoomLimit.members, id: \.self) { i in
          if i < members.count {
            Seat(participant: members[i])
              .id(members[i].id)
              .transition(.scale(scale: 0.4).combined(with: .opacity))
          } else {
            EmptySeat()
          }
        }
        .frame(width: 64)
      }
      .scrollTargetLayout()
      // 王冠が上にはみ出すぶん
      .padding(.top, 18)
      .padding(.bottom, 16)
    }
    .contentMargins(.horizontal, 12, for: .scrollContent)
    .scrollIndicators(.hidden)
    // 入ってきた人が見えるよう、いちばん新しい人まで送る
    .scrollPosition(id: .constant(members.last?.id), anchor: .trailing)
    .animation(.spring(duration: 0.45, bounce: 0.45), value: members.map(\.id))
    .clipShape(RoundedRectangle(cornerRadius: 22))
    .background(CardBackground())
  }
}

/// 難易度の選択（ホストだけ）。出題の場面は名前もサムネイルもスタートまで見せない。
/// 場面は、その部屋でまだ出ていない作り置きの場面からランダムに出る（docs/design/ui/screens/lobby.md）。
/// 下には、選んでいる難易度の例の場面を絵だけ出す（例は出題しない）
private struct DifficultyPicker: View {
  @Binding var selected: SceneDifficulty
  /// 選んでいる難易度の例の場面。無ければ絵を出さない
  let example: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("難易度")
        .font(Theme.font(16, .heavy))
      HStack(spacing: 8) {
        ForEach(Array(SceneDifficulty.allCases.enumerated()), id: \.element) { i, difficulty in
          tile(difficulty, level: i + 1)
        }
      }
      if let example, let image = ExampleScene.image(example) {
        ExampleScene(image: image)
      }
    }
    .padding(14)
    .background(CardBackground())
    .animation(.easeOut(duration: 0.2), value: selected)
    .sensoryFeedback(.selection, trigger: selected)
  }

  /// 難しさを 1〜3 個の点で見せる
  private func tile(_ difficulty: SceneDifficulty, level: Int) -> some View {
    let on = selected == difficulty
    return Button {
      selected = difficulty
    } label: {
      VStack(spacing: 8) {
        HStack(spacing: 4) {
          ForEach(1...SceneDifficulty.allCases.count, id: \.self) { n in
            Circle()
              .fill(n <= level ? (on ? Color.white : Theme.accent) : (on ? Color.white.opacity(0.35) : Theme.line))
              .frame(width: 9, height: 9)
          }
        }
        Text(difficulty.label)
          .font(Theme.font(15, .heavy))
          .foregroundStyle(on ? .white : Theme.ink)
      }
      .frame(maxWidth: .infinity)
      .frame(height: 72)
      .background(on ? Theme.accent : Theme.background, in: RoundedRectangle(cornerRadius: 14))
      .overlay {
        RoundedRectangle(cornerRadius: 14)
          .strokeBorder(on ? Theme.accent : Theme.line, lineWidth: on ? 3 : 1.5)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(difficulty.label)
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}

/// 苦手の場面で練習する部屋の、難易度の代わりの表示（ホストだけ）。場面の名前と一言。
/// 待合では 3D を出さない（ExampleScene と同じ理由）ので、絵は出さない
private struct PracticeScene: View {
  let scene: WeakScene

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("苦手の場面")
        .font(Theme.font(16, .heavy))
      HStack(alignment: .center, spacing: 14) {
        Image(systemName: "scope")
          .font(.system(size: 26, weight: .bold))
          .foregroundStyle(Theme.accent)
          .frame(width: 56, height: 56)
          .background(Theme.accentSoft, in: Circle())
        VStack(alignment: .leading, spacing: 4) {
          Text(scene.name)
            .font(Theme.font(22, .black))
            .fixedSize(horizontal: false, vertical: true)
          Text(scene.pitch)
            .font(Theme.font(15, .heavy))
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 0)
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.background, in: RoundedRectangle(cornerRadius: 14))
    }
    .padding(14)
    .background(CardBackground())
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("lobby-practice")
  }
}

/// 例の場面の止めた絵（Room/Examples/<sceneID>.png）。触れない。
/// png は、待機の画面の 3D と同じ向きで組んだ場面を、318×170pt（3 倍）の枠でアプリの画面から切り出したもの。
/// 待合では 3D（RealityView）を出さない。待合で 3D を出しておくと、スタート後の回転中と録音中の 3D が
/// 出なくなる・ずれることがある（シミュレータで確かめた）ため。png の無い例は絵を出さない
/// （作り置きの例を差し替えたら、png も作り直す）
private struct ExampleScene: View {
  let image: UIImage

  static func image(_ sceneID: String) -> UIImage? {
    guard let image = UIImage(named: sceneID) else {
      sceneLog.notice("待合の例の絵（Room/Examples/\(sceneID, privacy: .public).png）がありません")
      return nil
    }
    return image
  }

  var body: some View {
    Image(uiImage: image)
      .resizable()
      .scaledToFill()
      .frame(maxWidth: .infinity)
      .frame(height: 170)
      .background(Theme.background)
      .clipShape(RoundedRectangle(cornerRadius: 14))
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// 部屋が場面を AI で作っている間の表示（ホストも参加者も同じ）。文言は決まっていて、どんな場面かは匂わせない
private struct SceneGenerating: View {
  var body: some View {
    VStack(spacing: 6) {
      LoadingRunner(size: 230, announces: false)
      ShimmerText(text: "AI が場面を生成中…")
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}

/// 白いカードの下地。影は下地だけに付け、中の文字には付けない
private struct CardBackground: View {
  var body: some View {
    RoundedRectangle(cornerRadius: 22)
      .fill(Theme.card)
      .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
  }
}

private struct Seat: View {
  let participant: Participant

  private var offline: Bool { participant.status == .offline }

  var body: some View {
    VStack(spacing: 4) {
      Avatar(name: participant.name, color: offline ? 0xC9CBE0 : participant.color, size: 52)
        .overlay(alignment: .top) {
          if participant.isHost {
            Image(systemName: "crown.fill")
              .font(.system(size: 15, weight: .bold))
              .foregroundStyle(Color(hex: 0xF5B82E))
              .offset(y: -13)
              .rotationEffect(.degrees(-8))
          }
        }
        .overlay(alignment: .bottomTrailing) {
          if offline {
            Circle().fill(Theme.offlineIcon)
              .frame(width: 20, height: 20)
              .overlay {
                Image(systemName: "xmark")
                  .font(.system(size: 9, weight: .black))
                  .foregroundStyle(Theme.gray)
              }
              .overlay { Circle().strokeBorder(.white, lineWidth: 2) }
              .offset(x: 3, y: 3)
          }
        }
      Text(participant.name)
        .font(Theme.font(14, .heavy))
        .foregroundStyle(offline ? Theme.gray : Theme.ink)
        .lineLimit(1)
      Text(subtitle)
        .font(Theme.font(11, .heavy))
        .foregroundStyle(offline ? Theme.gray : Theme.accent)
        .frame(height: 13)
    }
    .accessibilityElement(children: .combine)
  }

  private var subtitle: String {
    if offline { "切断中" } else if participant.isSelf { "あなた" } else { "" }
  }
}

private struct EmptySeat: View {
  var body: some View {
    VStack(spacing: 4) {
      Circle()
        .strokeBorder(Theme.disabledBorder, style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
        .frame(width: 52, height: 52)
      Text(" ").font(Theme.font(14, .heavy))
      Text(" ").font(Theme.font(11, .heavy)).frame(height: 13)
    }
    .accessibilityHidden(true)
  }
}

/// 参加者が、ホストのスタートを待つあいだの表示。走る人（LoadingRunner）の下に一言を出す。
/// 一言は、ホストの画面の「スタート」と同じ高さ（64pt）の枠の真ん中に置く。
/// VoiceOver は一言だけを読む（走る人の「読み込み中」は読ませない。LoadingRunner の announces）
private struct HostWaiting: View {
  /// 走る人を出すか。場面を作っている間は、真ん中に大きな走る人（SceneGenerating）が出るので出さない
  let showsRunner: Bool

  /// 走る人の大きさ。いちばん低い iPhone SE（高さ 667pt）の参加者の待合でも、参加者の一覧と重ならず、
  /// スクロールせずに収まる大きさ。コマの上の 1 割ほどは空いている
  static let runnerSize: CGFloat = 140

  var body: some View {
    VStack(spacing: 0) {
      if showsRunner {
        LoadingRunner(size: Self.runnerSize, announces: false)
          .transition(.opacity)
      }
      Text("ホストのスタートを待っています")
        .font(Theme.font(16, .heavy))
        .foregroundStyle(Theme.muted)
        .frame(height: 64)
    }
    .animation(.easeInOut(duration: 0.3), value: showsRunner)
  }
}
