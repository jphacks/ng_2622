import type { Env, Hono, Schema } from "hono";
import {
  type GenerateSpecOptions,
  generateSpecs,
  resolver,
} from "hono-openapi";
import { ClientMessage, ServerMessage } from "./schemas/ws";

// OpenAPI の生成設定。GET /openapi.json と、backend/openapi.json を作るスクリプト（scripts/generate-openapi.ts）の両方で使う

export const openAPIOptions: Partial<GenerateSpecOptions> = {
  documentation: {
    openapi: "3.1.0",
    info: {
      title: "ScenEnglish backend",
      version: "0.1.0",
      license: { name: "MIT", identifier: "MIT" },
      description:
        "部屋の作成と参加、ラウンドの進行の API。WebSocket（GET /rooms/{roomId}/ws）で流れるメッセージは OpenAPI の paths では表せないので、components.schemas の ClientMessage（iPhone → 部屋）と ServerMessage（部屋 → iPhone）に型だけを載せている。",
    },
    // 全体の認証は無い（部屋の中の本人確認は WebSocket の join で送る合言葉で行う）。
    // POST /scenes/generate だけ合言葉（sceneWriteToken）が要る
    security: [],
    // 本番の URL はリポジトリに載せない。相対パスにして、/docs を開いたサーバー（手元・プレビュー・本番）にそのまま送る。
    // iPhone は接続先の URL をアプリの設定で持つ
    servers: [{ url: "/", description: "この API を返しているサーバー" }],
    components: {
      securitySchemes: {
        sceneWriteToken: {
          type: "http",
          scheme: "bearer",
          description:
            "場面を作る口の合言葉（手元の wrangler dev に渡す SCENE_WRITE_TOKEN）",
        },
      },
      // paths から参照されない WebSocket のメッセージの型を components.schemas に載せるための入れ物
      responses: {
        ClientMessage: {
          description: "WebSocket で iPhone から部屋へ送るメッセージ",
          content: { "application/json": { schema: resolver(ClientMessage) } },
        },
        ServerMessage: {
          description: "WebSocket で部屋から iPhone へ届くメッセージ",
          content: { "application/json": { schema: resolver(ServerMessage) } },
        },
      },
    },
  },
};

export const buildOpenAPISpec = async <E extends Env, S extends Schema>(
  app: Hono<E, S, string>,
) => normalizeNullable(await generateSpecs(app, openAPIOptions));

// zod の .nullable() は `anyOf: [X, { type: "null" }]` になるが、iOS が使う swift-openapi-generator は
// anyOf の中の `{ type: "null" }` を読めず、その項目ごと落とす（additionalProperties: false なので、
// 実際のメッセージを decode できなくなる）。そこで、生成器が読める同じ意味の形に書き換える。
//   スカラー型: { type: ["integer", "null"], ...X の他の制約 }
//   $ref（object）: { type: ["object", "null"], allOf: [{ $ref }] }
// それ以外の anyOf は触らない。検証（zod）は変えず、出す OpenAPI の書き方だけを変える
type JSONObject = { [key: string]: unknown };

const isObject = (v: unknown): v is JSONObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNullSchema = (v: unknown) =>
  isObject(v) && Object.keys(v).length === 1 && v.type === "null";

export const normalizeNullable = <T>(spec: T): T => {
  const schemas =
    isObject(spec) && isObject(spec.components)
      ? spec.components.schemas
      : undefined;
  const refIsObject = (ref: string) => {
    const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
    const target = name && isObject(schemas) ? schemas[name] : undefined;
    return isObject(target) && target.type === "object";
  };

  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isObject(node)) return node;
    const out: JSONObject = {};
    for (const [key, value] of Object.entries(node)) out[key] = visit(value);

    const { anyOf, ...siblings } = out;
    if (!Array.isArray(anyOf) || anyOf.length !== 2) return out;
    const nulls = anyOf.filter(isNullSchema);
    const [inner] = anyOf.filter((v) => !isNullSchema(v));
    if (nulls.length !== 1 || !isObject(inner)) return out;

    if (typeof inner.$ref === "string") {
      // object 以外を指す $ref は type を決められないので、そのままにする
      if (Object.keys(inner).length !== 1 || !refIsObject(inner.$ref)) {
        return out;
      }
      return { type: ["object", "null"], allOf: [inner], ...siblings };
    }
    if (typeof inner.type === "string") {
      return { ...inner, type: [inner.type, "null"], ...siblings };
    }
    return out;
  };

  return visit(spec) as T;
};
