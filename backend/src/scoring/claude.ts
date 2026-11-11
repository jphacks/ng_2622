// 採点で Claude を呼ぶときの共通の物（既定のモデルと effort・失敗の型）。呼び出しの本体は checklistGrade.ts

export const DEFAULT_MODEL = "claude-haiku-5-5";
const DEFAULT_EFFORT = "high";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

// 知らない値は既定に戻す（設定の打ち間違いで採点を止めないため）
export const effortOf = (raw: string | undefined): Effort =>
  raw && EFFORTS.includes(raw) ? (raw as Effort) : DEFAULT_EFFORT;

export class ClaudeError extends Error {}
