import SwiftUI

/// 待合。部屋のコードと QR、参加者を見せる。ホストだけがシーンを選び、「スタート」を押せる。
/// 選んだシーンは参加者には見せない（ラウンドが始まると全員の画面に出る）
struct LobbyView: View {
  let session: RoomSession
  let onLeave: () -> Void

  /// ホストが選んだシーンの ID。nil は「おまかせ」
  @State private var sceneID: String?
  /// 「AI で作る」の一言と、作った場面
  @State private var generator = SceneGenerator()
  @State private var showsGenerator = false

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        CircleIconButton(systemName: "xmark", label: "退出", action: onLeave)
        Spacer()
      }
      .padding(.top, 8)

      ticket
        .padding(.top, 10)
      seats
        .padding(.top, 16)
      if session.isHost {
        ScenePicker(selected: $sceneID, made: generator.made) { showsGenerator = true }
          .padding(.top, 16)
      }

      Spacer(minLength: 12)
      if session.isHost {
        Button("スタート") { session.start(sceneID: sceneID) }
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
    // シートを閉じたら、作っている途中でもやめる（閉じた＝その場面は要らない）
    .sheet(isPresented: $showsGenerator, onDismiss: generator.cancel) {
      SceneGenerateSheet(generator: generator)
        .presentationDragIndicator(.visible)
    }
    // 作れたら、その場面を選んだ状態にして待合に戻る。作り直して同じ場面が返っても Made は変わる
    .onChange(of: generator.made) { _, made in
      guard let made else { return }
      sceneID = made.id
      showsGenerator = false
    }
    // 待合を離れたら、通信と時間切れのタイマーを止める
    .onDisappear(perform: generator.cancel)
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

  /// 参加者を席のように並べる。空いた席は点線
  private var seats: some View {
    let members = session.participants
    let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)
    return LazyVGrid(columns: columns, spacing: 16) {
      ForEach(0..<RoomLimit.members, id: \.self) { i in
        if i < members.count {
          Seat(participant: members[i])
            .id(members[i].id)
            .transition(.scale(scale: 0.4).combined(with: .opacity))
        } else {
          EmptySeat()
        }
      }
    }
    .animation(.spring(duration: 0.45, bounce: 0.45), value: members.map(\.id))
    .padding(.horizontal, 12)
    .padding(.vertical, 18)
    .background(CardBackground())
  }
}

/// シーンの一覧（ホストだけ）。既定は「おまかせ」。「AI で作る」で作った場面は一覧の下に出す
private struct ScenePicker: View {
  /// nil は「おまかせ」
  @Binding var selected: String?
  /// AI で作った場面（まだ無ければ nil）
  let made: SceneGenerator.Made?
  /// 「AI で作る」を開く
  let onGenerate: () -> Void
  /// シーンごとの★の平均。読めなければ出さない
  @State private var ratings: [String: SceneRating] = [:]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("シーン")
          .font(Theme.font(16, .heavy))
        Spacer()
        generateButton
        randomButton
      }
      HStack(spacing: 8) {
        ForEach(SceneCatalog.all) { scene in
          tile(scene)
        }
      }
      if let made {
        madeTile(made)
          .transition(.scale(scale: 0.9).combined(with: .opacity))
      }
    }
    .padding(14)
    .background(CardBackground())
    .animation(.easeOut(duration: 0.2), value: selected)
    .animation(.easeOut(duration: 0.25), value: made)
    .task { ratings = (try? await SceneReviews.client.ratings()) ?? [:] }
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

  /// 「AI で作る」。一言から場面を作るシートを開く
  private var generateButton: some View {
    Button(action: onGenerate) {
      HStack(spacing: 5) {
        Image(systemName: "sparkles")
          .font(.system(size: 13, weight: .bold))
        Text("AI で作る")
          .font(Theme.font(14, .heavy))
      }
      .foregroundStyle(Theme.accent)
      .padding(.horizontal, 14)
      .frame(height: 32)
      .background(Theme.accentSoft, in: Capsule())
    }
  }

  /// AI で作った場面。押すと選ぶ。「作り直す」でシートを開く
  private func madeTile(_ made: SceneGenerator.Made) -> some View {
    let on = selected == made.id
    return HStack(spacing: 12) {
      Button {
        selected = made.id
      } label: {
        HStack(spacing: 12) {
          RoundedRectangle(cornerRadius: 10)
            .fill(on ? Theme.accent : Theme.accentSoft)
            .frame(width: 44, height: 44)
            .overlay {
              Image(systemName: "sparkles")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(on ? .white : Theme.accent)
            }
          VStack(alignment: .leading, spacing: 2) {
            Text(made.name)
              .font(Theme.font(15, .heavy))
              .foregroundStyle(on ? Theme.accent : Theme.ink)
              .lineLimit(1)
            Text("AI で作った場面・\(made.difficulty.label)")
              .font(Theme.font(11, .heavy))
              .foregroundStyle(Theme.muted)
          }
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("AI で作った場面 \(made.name)")
      .accessibilityAddTraits(on ? .isSelected : [])
      Button("作り直す", action: onGenerate)
        .font(Theme.font(13, .heavy))
        .foregroundStyle(Theme.accent)
    }
    .padding(8)
    .background(Theme.background, in: RoundedRectangle(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14)
        .strokeBorder(on ? Theme.accent : Theme.line, lineWidth: on ? 3 : 1.5)
    }
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
        RatingBadge(rating: ratings[scene.id])
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(scene.name)
    .accessibilityAddTraits(on ? .isSelected : [])
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
