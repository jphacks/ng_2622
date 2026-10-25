import SwiftUI

/// 待合。部屋のコードと QR、参加者を見せる。ホストだけがシーン（または難易度）を選び、「スタート」を押せる。
/// 選んだシーンは参加者には見せない（ラウンドが始まると全員の画面に出る）
struct LobbyView: View {
  let session: RoomSession
  let onLeave: () -> Void
  /// シーンの選び方（SCENE_PICK）。difficulty なら難易度だけを選ぶ
  var pick: ScenePick = AppConfig.current.scenePick
  /// 難易度ごとの例の場面（出題はしない）。Mock も Live も同梱の作り置きの一覧から出す（バックエンドは呼ばない）
  var example: (SceneDifficulty) -> String? = { ScenePool.bundled.example(of: $0) }

  /// ホストが選んだシーンの ID。nil は「おまかせ」
  @State private var sceneID: String?
  /// ホストが選んだ難易度（pick が difficulty のとき）
  @State private var difficulty = SceneDifficulty.easy

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
          if session.isHost {
            switch pick {
            case .difficulty:
              DifficultyPicker(selected: $difficulty, example: example(difficulty))
                .padding(.top, 16)
            case .list:
              ScenePicker(selected: $sceneID)
                .padding(.top, 16)
            }
          }
        }
        // カードの影が切れないよう、スクロールの枠だけ左右に広げる
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
      }
      .padding(.horizontal, -16)
      .scrollBounceBehavior(.basedOnSize)
      .scrollIndicators(.hidden)

      if session.isHost {
        Button("スタート", action: start)
          .buttonStyle(BigButtonStyle(kind: .primary))
          .padding(.bottom, 30)
      } else {
        HostWaiting()
          .frame(height: 64)
          .padding(.bottom, 30)
      }
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
  }

  private func start() {
    switch pick {
    case .difficulty: session.start(difficulty: difficulty)
    case .list: session.start(sceneID: sceneID)
    }
  }

  /// 部屋のコードと QR
  private var ticket: some View {
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
    .background(CardBackground())
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

/// シーンの一覧（ホストだけ）。既定は「おまかせ」。選ぶときに迷わせないよう、評価の星は出さない（評価は結果の画面で付ける）
private struct ScenePicker: View {
  /// nil は「おまかせ」
  @Binding var selected: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("シーン")
          .font(Theme.font(16, .heavy))
        Spacer()
        randomButton
      }
      HStack(spacing: 8) {
        ForEach(SceneCatalog.all) { scene in
          tile(scene)
        }
      }
    }
    .padding(14)
    .background(CardBackground())
    .animation(.easeOut(duration: 0.2), value: selected)
  }

  /// 「おまかせ」。選ぶとスタートのときにランダムに決まる
  private var randomButton: some View {
    let on = selected == nil
    return Button {
      selected = nil
    } label: {
      HStack(spacing: 5) {
        Image(systemName: "dice.fill")
          .font(.system(size: 13, weight: .bold))
        Text("おまかせ")
          .font(Theme.font(14, .heavy))
      }
      .foregroundStyle(on ? .white : Theme.accent)
      .padding(.horizontal, 14)
      .frame(height: 32)
      .background(on ? Theme.accent : Theme.accentSoft, in: Capsule())
    }
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  private func tile(_ scene: SceneInfo) -> some View {
    let on = selected == scene.id
    return Button {
      selected = scene.id
    } label: {
      VStack(spacing: 5) {
        Color.clear
          .aspectRatio(1.4, contentMode: .fit)
          .overlay {
            if let image = SceneCatalog.thumbnail(scene.id) {
              Image(uiImage: image)
                .resizable()
                .scaledToFill()
            }
          }
          .clipShape(RoundedRectangle(cornerRadius: 12))
          .overlay {
            RoundedRectangle(cornerRadius: 12)
              .strokeBorder(on ? Theme.accent : Theme.line, lineWidth: on ? 3 : 1.5)
          }
        Text(scene.name)
          .font(Theme.font(14, .heavy))
          .foregroundStyle(on ? Theme.accent : Theme.ink)
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(scene.name)
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}

/// 難易度の選択（ホストだけ、SCENE_PICK = difficulty）。出題の場面は名前もサムネイルもスタートまで見せない。
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
      if let example {
        ExampleScene(sceneID: example)
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

/// 例の場面の絵。待合では動かさないので、3D を組み立てずに止めた絵（Room/Examples/<id>.png）を出す。触れない。
/// png は、下の 3D と同じ向き・同じ枠（318×170pt を 3 倍）でアプリの画面から切り出したもの。
/// index.json の例を変えて png が無いときは、これまでどおり 3D で出す
private struct ExampleScene: View {
  let sceneID: String

  var body: some View {
    Group {
      if let image = UIImage(named: sceneID) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        // 枠が低いので、カメラを近づけて場面を枠いっぱいに出す。難易度を変えたら作り直す（読み込みの状態も新しくする）
        DioramaView(sceneID: sceneID, yaw: -20, tilt: SceneOrbit.defaultTilt, distance: 4.6)
          .id(sceneID)
      }
    }
    .frame(maxWidth: .infinity)
    .frame(height: 170)
    .background(Theme.background)
    .clipShape(RoundedRectangle(cornerRadius: 14))
    .allowsHitTesting(false)
    .accessibilityHidden(true)
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

/// 参加者が、ホストのスタートを待つあいだの表示
private struct HostWaiting: View {
  @State private var phase = false

  var body: some View {
    VStack(spacing: 10) {
      Text("ホストのスタートを待っています")
        .font(Theme.font(16, .heavy))
        .foregroundStyle(Theme.muted)
      HStack(spacing: 8) {
        ForEach(0..<3, id: \.self) { i in
          Circle()
            .fill(Theme.accent)
            .frame(width: 9, height: 9)
            .opacity(phase ? 1 : 0.25)
            .animation(.easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2), value: phase)
        }
      }
    }
    .onAppear { phase = true }
  }
}
