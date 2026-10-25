import Anthropic from "@anthropic-ai/sdk";
import { ClaudeError, DEFAULT_MODEL, effortOf } from "./claude";
import type { Scene, SceneElement, ScoringEnv } from "./types";

// 場面の事実（layout.ts の describeLayout）から、採点の基準（場面の説明・描写してほしい要素・配点）を作る。
// 同じ場面の全員を同じ基準で採点するため、作った基準は呼ぶ側で覚えて使い回す

// 要素の点の合計と、一覧にない描写の加点の上限。足して 100
const ELEMENT_TOTAL = 90;
const EXTRA_MAX = 10;
const MIN_ELEMENTS = 3;
const MAX_ELEMENTS = 8;

export type Difficulty = "easy" | "normal" | "hard";

// 難しさごとの要素の数の目安（scene-protocol.md の「AI で場面を作る」と同じ）
const ELEMENT_COUNT: Record<Difficulty, string> = {
  easy: "4 to 5",
  normal: "5 to 6",
  hard: "7 to 8",
};

const SYSTEM = `You prepare the grading rubric for a party game where Japanese learners of English describe a 3D scene aloud in up to 20 seconds.
You get the exact contents of the scene, generated from the 3D scene data: every thing with its key, Japanese label, English words, pose, color (only when known), size, what it is on, what it is next to or near, what it faces, and how it moves. Nothing else is in the scene.

Write:
1. name: a short Japanese name for the scene (e.g. 公園で遊ぶ男の子と犬).
2. description: an English description of the whole scene that states every fact you were given, in plain sentences. Do not add anything that is not in the facts: no colors, weather, feelings or places that are not given.
3. elements: things a learner is expected to describe, from the most important (who is doing what, the main things) to details (counts, positions, colors). For each element:
   - id: a short snake_case id.
   - label: a short Japanese label (e.g. 犬がボールに向かって走っている).
   - weight: 1 to 5, how important it is for describing the scene. Actions and relations between things deserve higher weights than just naming a thing, so that players try to speak in sentences.
   - accept: English wording that earns full points, with synonyms from the given words and a short example sentence (e.g. "dog, puppy; e.g. A dog is running.").
   - partial: wording that earns half points (a vaguer or incomplete description, e.g. "animal, pet"), or null if half points make no sense.
   Rules:
   - Use only the given facts. Use the place (the ground) as one element when it is clear (e.g. grass -> park, garden, lawn).
   - Each element is exactly one checkable idea. Keep "something is there" separate from what it does, what it looks like, and where it is:
     good: "boy" (a boy is there), "boy_run" (the boy is running), "ball_red" (the ball is red).
     bad: "boy_run_ball" = "a boy is running to the red ball" (mixes several ideas into one element).
   - For an action, color, count or position element, accept must require that detail itself (e.g. "says the boy is running"), and partial must not be just naming the person or thing.
   - Make a color element only when the color is given in the facts (in the color field, the label or the words).
   - Do not use left/right, front/back or behind; players see the scene from any side. Use the given relations: on, next to, near, facing, toward.
   - Use everyday words a beginner can say; put harder synonyms in accept as alternatives.`;

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          weight: { type: "integer" },
          accept: { type: "string" },
          partial: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["id", "label", "weight", "accept", "partial"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "description", "elements"],
  additionalProperties: false,
};

type Drafted = {
  name: string;
  description: string;
  elements: {
    id: string;
    label: string;
    weight: number;
    accept: string;
    partial: string | null;
  }[];
};

// 重みを、合計が ELEMENT_TOTAL になる整数の点に直す。端数は重い要素から 1 点ずつ足す
export const allocatePoints = (weights: number[], total = ELEMENT_TOTAL) => {
  const w = weights.map((n) => Math.max(1, Math.min(5, Math.round(n) || 1)));
  const sum = w.reduce((a, b) => a + b, 0);
  const points = w.map((n) => Math.floor((n * total) / sum));
  let rest = total - points.reduce((a, b) => a + b, 0);
  const order = w
    .map((n, i) => ({ i, frac: (n * total) / sum - points[i] }))
    .sort((a, b) => b.frac - a.frac || w[b.i] - w[a.i]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) {
    points[order[k].i]++;
  }
  return points;
};

// Claude の下書きを採点に使える形に直す。id の重なり・空の要素を除き、多すぎる要素は切る
export const toScene = (id: string, drafted: Drafted): Scene => {
  const seen = new Set<string>();
  const kept = drafted.elements
    .map((e) => ({
      ...e,
      id: e.id.trim().replace(/[^A-Za-z0-9_]+/g, "_") || "element",
    }))
    .filter((e) => e.accept.trim() !== "" && e.label.trim() !== "")
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .slice(0, MAX_ELEMENTS);
  if (kept.length < MIN_ELEMENTS) {
    throw new ClaudeError(`採点の要素が少なすぎる（${kept.length} 個）`);
  }
  const points = allocatePoints(kept.map((e) => e.weight));
  const elements: SceneElement[] = kept.map((e, i) => ({
    id: e.id,
    label: e.label,
    points: points[i],
    accept: e.accept,
    ...(e.partial?.trim() ? { partial: e.partial } : {}),
  }));
  return {
    id,
    name: drafted.name,
    description: drafted.description,
    elements,
    extraMax: EXTRA_MAX,
    fromLayout: true,
  };
};

export async function draftRubric(
  env: ScoringEnv,
  id: string,
  facts: string,
  difficulty: Difficulty,
): Promise<Scene> {
  if (!env.CLAUDE_API_KEY) {
    throw new ClaudeError("CLAUDE_API_KEY が要る");
  }
  const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  const response = await client.messages.create({
    model: env.CLAUDE_RUBRIC_MODEL || env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: 8000,
    output_config: {
      effort: effortOf(env.CLAUDE_RUBRIC_EFFORT || env.CLAUDE_EFFORT),
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Difficulty: ${difficulty} (write ${ELEMENT_COUNT[difficulty]} elements)\n\n${facts}`,
      },
    ],
  });
  if (response.stop_reason !== "end_turn") {
    throw new ClaudeError(`Claude が途中で止まった: ${response.stop_reason}`);
  }
  const text = response.content.find((b) => b.type === "text");
  if (text?.type !== "text") {
    throw new ClaudeError("Claude の応答に本文が無い");
  }
  return toScene(id, JSON.parse(text.text) as Drafted);
}
