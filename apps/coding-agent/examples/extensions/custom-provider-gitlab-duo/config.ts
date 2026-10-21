import type configTypes from "./config.types.ts";

const GITLAB_COM_URL = "https://gitlab.com";
const AI_GATEWAY_URL = "https://cloud.gitlab.com";
const ANTHROPIC_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/anthropic/`;
const OPENAI_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/openai/v1`;

const BUNDLED_CLIENT_ID = "da4edff2e6ebd2bc3208611e2768bc1c1dd7be791dc5ff26ca34ca9ee44f7d4b";
const OAUTH_SCOPES = ["api"];
const REDIRECT_URI = "http://127.0.0.1:8080/callback";
const DIRECT_ACCESS_TTL = 25 * 60 * 1000;

const MODELS: configTypes.GitLabModel[] = [
  {
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    contextWindow: 1000000,
    cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
    id: "claude-opus-4-8",
    input: ["text", "image"],
    maxTokens: 128000,
    name: "Claude Opus 4.8",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  },
  {
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    contextWindow: 1000000,
    cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
    id: "claude-sonnet-4-6",
    input: ["text", "image"],
    maxTokens: 64000,
    name: "Claude Sonnet 4.6",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  },
  {
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    contextWindow: 200000,
    cost: { cacheRead: 1.5, cacheWrite: 18.75, input: 15, output: 75 },
    id: "claude-opus-4-5-20251101",
    input: ["text", "image"],
    maxTokens: 32000,
    name: "Claude Opus 4.5",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  },
  {
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    contextWindow: 200000,
    cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
    id: "claude-sonnet-4-5-20250929",
    input: ["text", "image"],
    maxTokens: 16384,
    name: "Claude Sonnet 4.5",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  },
  {
    backend: "anthropic",
    baseUrl: ANTHROPIC_PROXY_URL,
    contextWindow: 200000,
    cost: { cacheRead: 0.1, cacheWrite: 1.25, input: 1, output: 5 },
    id: "claude-haiku-4-5-20251001",
    input: ["text", "image"],
    maxTokens: 8192,
    name: "Claude Haiku 4.5",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  },

  {
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    contextWindow: 272000,
    cost: { cacheRead: 0.5, cacheWrite: 0, input: 5, output: 30 },
    id: "gpt-5.5-2026-04-23",
    input: ["text", "image"],
    maxTokens: 128000,
    name: "GPT-5.5",
    reasoning: true,
  },
  {
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 2.5, output: 10 },
    id: "gpt-5.1-2025-11-13",
    input: ["text", "image"],
    maxTokens: 16384,
    name: "GPT-5.1",
    reasoning: true,
  },
  {
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0.15, output: 0.6 },
    id: "gpt-5-mini-2025-08-07",
    input: ["text", "image"],
    maxTokens: 16384,
    name: "GPT-5 Mini",
    reasoning: true,
  },
  {
    backend: "openai",
    baseUrl: OPENAI_PROXY_URL,
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 2.5, output: 10 },
    id: "gpt-5-codex",
    input: ["text", "image"],
    maxTokens: 16384,
    name: "GPT-5 Codex",
    reasoning: true,
  },
];

const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]));

const config = {
  AI_GATEWAY_URL,
  ANTHROPIC_PROXY_URL,
  BUNDLED_CLIENT_ID,
  DIRECT_ACCESS_TTL,
  GITLAB_COM_URL,
  MODELS,
  MODEL_MAP,
  OAUTH_SCOPES,
  OPENAI_PROXY_URL,
  REDIRECT_URI,
};

export default config;
