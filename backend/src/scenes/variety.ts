import type { Part, PlanItem, SceneSentences } from "./types";

// 場面が似すぎないようにするための材料と、作り置きの段取りで使う小さな関数。
// 実測で、理由が「雨」「転んだ人を助ける」ばかりになった（指示の例と、名指しした原因をそのまま写していた）。
// - reasonSeeds: 1 回目の指示に並べる「理由にできる見える出来事」。型の決め打ちではなく、選べる材料として出す
// - summarizeScene: すでに作った場面の要約。次の場面の指示に渡して「これらと違う場面にする」と言う（GenerateV2Input.avoid）
// - countCauses・overusedCauses: 級の中で理由の原因が重なりすぎていないかを数える（裏取りではなく、作り置きを選ぶときに使う）

/**
 * 理由にできる見える出来事。needs はそれを描くのに要るポーズ（parts.json の pose）か部品の id で、
 * 全部が今の部品にあるものだけを指示に出す。text は「見える原因 -> 行動（-> 目的や結果）」
 */
const REASON_SEEDS: { needs: string[]; text: string }[] = [
  {
    needs: ["throw", "catch"],
    text: "a boy throws a ball -> another boy waits -> to catch it",
  },
  {
    needs: ["throw", "animal_run_dog_a"],
    text: "a boy throws a ball -> a dog runs across the grass -> to get it",
  },
  {
    needs: ["sleep", "wake"],
    text: "a boy sleeps at his desk -> a woman wakes him",
  },
  {
    needs: ["raise_hand", "question"],
    text: "a boy raises his hand -> a woman (the teacher) asks him",
  },
  {
    needs: ["ask", "take_book"],
    text: "a girl points at a book on a high shelf -> a tall boy takes it -> to give it to her",
  },
  {
    needs: ["poke", "balloon"],
    text: "a balloon is caught high in a tree -> a man reaches it with a stick -> to get it down",
  },
  {
    needs: ["take_order", "sit"],
    text: "people sit at a table in a cafe -> the waiter takes their order",
  },
  {
    needs: ["serve", "sit"],
    text: "a person sits at a table -> a waiter brings drinks on a tray",
  },
  {
    needs: ["show_hand", "check_hand"],
    text: "a boy or a girl shows a hand -> a doctor or a mother checks it",
  },
  {
    needs: ["try_jacket", "show_jacket"],
    text: "a man tries on a jacket -> the clerk shows him another jacket",
  },
  {
    needs: ["peck", "feed"],
    text: "a bird is eating on the ground -> an old man feeds it",
  },
  {
    needs: ["cook", "set_plates"],
    text: "a woman is cooking -> a boy puts plates on the table -> so that they can eat",
  },
  {
    needs: ["train", "run_bag"],
    text: "a train is at the platform -> a man runs with his bag -> to catch it",
  },
  {
    needs: ["blow", "clap", "candles"],
    text: "a cake with candles is on the table -> a girl blows out the candles and the others clap",
  },
  {
    needs: ["spilled_juice", "wipe"],
    text: "juice is spilled next to a table -> a woman cleans the table",
  },
  {
    needs: ["shards_glass", "sweep"],
    text: "pieces of glass are on the floor -> a man cleans the floor with a broom",
  },
  {
    needs: ["kneel_build", "bucket"],
    text: "a boy builds a sand castle -> a girl brings a bucket of water -> to help him",
  },
  {
    needs: ["lift_desk"],
    text: "a desk is too big for one person -> a boy and a girl carry it together",
  },
  {
    needs: ["carry", "offer"],
    text: "a girl carries a big box -> a boy offers a hand -> to help her",
  },
  {
    needs: ["pay", "basket"],
    text: "a woman pays at the counter -> a man waits behind her with his basket",
  },
  {
    needs: ["fallen", "help_up"],
    text: "a woman has fallen down -> a man helps her get up",
  },
  {
    needs: ["fallen", "bicycle_down"],
    text: "a bicycle is lying on the ground next to a woman who has fallen down -> someone comes to her",
  },
  {
    needs: ["rain", "umbrella"],
    text: "rain (outdoor scenes only) -> a girl shares her umbrella with a person who has none",
  },
  {
    needs: ["rain", "run"],
    text: "rain (outdoor scenes only) -> a person runs to the bus stop -> so as not to get wet",
  },
];

/** 1 回目の指示に並べる、理由にできる見える出来事。今の部品で描けるものだけ */
export const reasonSeeds = (parts: Part[]): string => {
  const have = new Set(
    parts.flatMap((p) => (p.pose ? [p.id, p.pose] : [p.id])),
  );
  return REASON_SEEDS.filter((s) => s.needs.every((n) => have.has(n)))
    .map((s) => `- ${s.text}`)
    .join("\n");
};

/** 部品が今の一覧に無く、指示に出ない出来事（テストで、材料が古くなっていないかを見る） */
export const missingSeedNeeds = (parts: Part[]): string[] => {
  const have = new Set(
    parts.flatMap((p) => (p.pose ? [p.id, p.pose] : [p.id])),
  );
  return [
    ...new Set(
      REASON_SEEDS.flatMap((s) => s.needs).filter((n) => !have.has(n)),
    ),
  ];
};

/**
 * すでに作った場面の要約（1 行）。名前、中心の動作、理由とつながり。
 * 次の場面の指示に渡して、同じ動作と同じ原因を避けさせる
 */
export const summarizeScene = (scene: SceneSentences): string => {
  const first = (accept: string) => accept.split("/")[0].trim();
  const of = (kinds: string[]) =>
    scene.checklist
      .filter((c) => kinds.includes(c.kind))
      .map((c) => first(c.accept));
  const centers = of(["center"]).join("; ");
  const reasons = of(["reason", "link"]).join("; ");
  return `${scene.name}: ${centers}${reasons ? ` | reason: ${reasons}` : ""}`;
};

const isLiving = (part: Part | undefined) =>
  part?.category === "person" || part?.category === "animal";

/**
 * 場面の理由の原因。reason・link の refs のうち、行動する人（refs の先頭の人や動物）以外を原因とみる。
 * 物は部品の id（rain・spilled_juice）、人や動物はポーズ（fallen・throw）で表す
 */
export const causesOf = (
  scene: SceneSentences & { items: PlanItem[] },
  partList: Part[],
): string[] => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  const partOf = (key: string) =>
    parts.get(scene.items.find((i) => i.key === key)?.part ?? "");
  const causes = new Set<string>();
  for (const c of scene.checklist) {
    if (c.kind !== "reason" && c.kind !== "link") continue;
    const actor = c.refs.find((r) => isLiving(partOf(r)));
    for (const r of c.refs) {
      if (r === actor) continue;
      const part = partOf(r);
      if (part) causes.add(isLiving(part) ? (part.pose ?? part.id) : part.id);
    }
  }
  return [...causes];
};

/** 原因ごとの、それを理由に使っている場面の数 */
export const countCauses = (
  scenes: (SceneSentences & { items: PlanItem[] })[],
  parts: Part[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const scene of scenes) {
    for (const cause of causesOf(scene, parts)) {
      counts.set(cause, (counts.get(cause) ?? 0) + 1);
    }
  }
  return counts;
};

/** 同じ原因を使ってよい場面の数の上限（級ごとに 10 場面作るときの目安） */
export const MAX_SAME_CAUSE = 3;

/** 上限を超えて使われている原因（多い順）。作り置きを選ぶときに、どの場面を作り直すかを決める材料 */
export const overusedCauses = (
  scenes: (SceneSentences & { items: PlanItem[] })[],
  parts: Part[],
  max = MAX_SAME_CAUSE,
): { cause: string; count: number }[] =>
  [...countCauses(scenes, parts)]
    .filter(([, count]) => count > max)
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
