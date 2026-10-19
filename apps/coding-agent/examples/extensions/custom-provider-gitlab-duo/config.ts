import type { ThinkingLevelMap } from "@msa/ai/compat";

export const GITLAB_COM_URL = "https://gitlab.com";
export const AI_GATEWAY_URL = "https://cloud.gitlab.com";
export const ANTHROPIC_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/anthropic/`;
export const OPENAI_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/openai/v1`;

export const BUNDLED_CLIENT_ID = "da4edff2e6ebd2bc3208611e2768bc1c1dd7be791dc5ff26ca34ca9ee44f7d4b";
export const OAUTH_SCOPES = ["api"];
export const REDIRECT_URI = "http://127.0.0.1:8080/callback";
export const DIRECT_ACCESS_TTL = 25 * 60 * 1000;

export type Backend = "anthropic" | "openai";

export interface GitLabModel {
  id: string;
  name: string;
  backend: Backend;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

export interface DirectAccessToken {
  token: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export const MODELS: GitLabModel[] = [
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5",
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 16384,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 8192,
  },

  {
    id: "gpt-5.5-2026-04-23",
    name: "GPT-5.5",
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.1-2025-11-13",
    name: "GPT-5.1",
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "gpt-5-mini-2025-08-07",
    name: "GPT-5 Mini",
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "gpt-5-codex",
    name: "GPT-5 Codex",
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
];

export const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]));
