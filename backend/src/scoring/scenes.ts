import scenes from "./scenes.json";
import type { Scene } from "./types";

// 仮のシーン。アプリと共有する置き場所が決まったら移す
// id は 3D シーン（assets/scenes/<id>）と同じにする（アプリが id で 3D を選ぶため）
const byId = new Map<string, Scene>(scenes.map((s) => [s.id, s]));

export const findScene = (id: string): Scene | undefined => byId.get(id);
