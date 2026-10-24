import type { Hono } from "hono";
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
    // 認証は無い（部屋の中の本人確認は WebSocket の join で送る合言葉で行う）
    security: [],
    // 本番の URL はリポジトリに載せない。相対パスにして、/docs を開いたサーバー（手元・プレビュー・本番）にそのまま送る。
    // iPhone は接続先の URL をアプリの設定で持つ
    servers: [{ url: "/", description: "この API を返しているサーバー" }],
    components: {
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

export const buildOpenAPISpec = (app: Hono) =>
  generateSpecs(app, openAPIOptions);
