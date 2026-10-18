import type { Provider } from "../models.ts";
import { anthropicProvider } from "./anthropic.ts";
import { openaiCodexProvider } from "./openai-codex.ts";
import { openaiProvider } from "./openai.ts";
import { opencodeGoProvider } from "./opencode-go.ts";
import { opencodeProvider } from "./opencode.ts";
import { openrouterProvider } from "./openrouter.ts";

export function builtinProviders(): Provider[] {
  return [
    anthropicProvider(),
    openaiProvider(),
    openaiCodexProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
    openrouterProvider(),
  ];
}
