import type { Provider } from "../models.ts";
import { anthropicProvider } from "./anthropic.ts";
import { deepseekProvider } from "./deepseek.ts";
import { googleProvider } from "./google.ts";
import { metaProvider } from "./meta.ts";
import { mistralProvider } from "./mistral.ts";
import { openaiCodexProvider } from "./openai-codex.ts";
import { openaiProvider } from "./openai.ts";
import { typesafeProvider } from "./typesafe.ts";
import { xaiProvider } from "./xai.ts";

export function labProviders(): Provider[] {
  return [
    anthropicProvider(),
    openaiProvider(),
    openaiCodexProvider(),
    googleProvider(),
    xaiProvider(),
    mistralProvider(),
    metaProvider(),
    deepseekProvider(),
    typesafeProvider(),
  ];
}
