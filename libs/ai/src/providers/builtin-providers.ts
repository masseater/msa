import type modelsTypes from "../models.types.ts";
import anthropic from "./anthropic.ts";
import openaiCodex from "./openai-codex.ts";
import openai from "./openai.ts";
import opencodeGo from "./opencode-go.ts";
import opencode from "./opencode.ts";
import openrouter from "./openrouter.ts";

const { anthropicProvider } = anthropic;
const { openaiProvider } = openai;
const { openaiCodexProvider } = openaiCodex;
const { opencodeProvider } = opencode;
const { opencodeGoProvider } = opencodeGo;
const { openrouterProvider } = openrouter;

function builtinProviders(): modelsTypes.Provider[] {
  return [
    anthropicProvider(),
    openaiProvider(),
    openaiCodexProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
    openrouterProvider(),
  ];
}

const builtinProvidersModule = {
  builtinProviders,
};

export default builtinProvidersModule;
