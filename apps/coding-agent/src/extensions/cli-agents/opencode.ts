/**
 * OpenCode Zen free models, each request run by `opencode run --standalone`.
 *
 * Environment overrides:
 *   OPENCODE_BIN             opencode binary (default: ~/.opencode/bin/opencode)
 *   OPENCODE_FREE_DATA_HOME  data dir for these runs (default: ~/.local/share/msa-opencode-free)
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { Model, SimpleStreamOptions, TranscriptContext } from "@msa/ai/compat";

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { streamViaCli, type CliBackend } from "./run.ts";
import { flattenTranscript } from "./transcript.ts";

const PROVIDER_ID = "opencode-free";

const FREE_MODELS = [
  { id: "ll-alpha-free", name: "LL Alpha Free", contextWindow: 200_000, maxTokens: 32_000 },
  { id: "cat-jam-free", name: "Cat Jam Free", contextWindow: 1_048_576, maxTokens: 131_072 },
  {
    id: "deepseek-v4.1-flash-free",
    name: "DeepSeek V4.1 Flash Free",
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    id: "glm-5.3-flash-free",
    name: "GLM-5.3-Flash Free",
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    id: "longcat-2.5-preview-free",
    name: "LongCat 2.5 Preview Free",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
  },
  {
    id: "mimo-v2.6-flash-free",
    name: "MiMo-V2.6-Flash Free",
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    id: "muse-spark-1.3-contributor-free",
    name: "Muse Spark 1.3 Free",
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  },
  {
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra Free",
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  {
    id: "nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning Free",
    contextWindow: 262_144,
    maxTokens: 262_144,
  },
  {
    id: "nemotron-3.5-super-vl-free",
    name: "Nemotron 3.5 Super VL Free",
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  },
  {
    id: "space-bunny-free",
    name: "Space Bunny Free",
    contextWindow: 1_048_576,
    maxTokens: 524_288,
  },
] as const;

function buildPrompt(messages: Parameters<typeof flattenTranscript>[0], cwd: string): string {
  return [
    "You are OpenCode, an interactive coding agent, called as the model behind the msa CLI.",
    `Working directory: ${cwd}`,
    "The transcript below is the conversation so far in that CLI. Continue it as the assistant.",
    "Use your own tools (read, grep, glob, edit, write, bash, ...) to inspect and change files whenever the task requires it.",
    "Do the work directly. The only thing that reaches the user is your final message text, so keep it to the assistant's reply and mention briefly anything you ran or changed.",
    "Answer in the user's language. Never mention this wrapper, the transcript format, or msa itself.",
    "",
    "----- conversation transcript -----",
    "",
    flattenTranscript(messages),
    "",
    "----- end of transcript -----",
    "",
    "Reply now as the assistant to the last user message.",
  ].join("\n");
}

/** The parts of `opencode run --format json` lines this backend reads. */
interface OpenCodeEvent {
  type?: string;
  error?: { message?: string };
  part?: {
    id?: string;
    type?: string;
    text?: string;
    tokens?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    };
  };
}

const backend: CliBackend<OpenCodeEvent> = {
  providerId: PROVIDER_ID,
  command(model, context, cwd) {
    return {
      bin: process.env["OPENCODE_BIN"]?.trim() || join(homedir(), ".opencode", "bin", "opencode"),
      args: [
        "run",
        "--standalone",
        "--auto",
        "--format",
        "json",
        "--model",
        `opencode/${model.id}`,
      ],
      stdin: buildPrompt(context.messages, cwd),
      env: {
        ...process.env,
        XDG_DATA_HOME:
          process.env["OPENCODE_FREE_DATA_HOME"]?.trim() ||
          join(homedir(), ".local", "share", "msa-opencode-free"),
      },
    };
  },
  handleEvent(event, sink) {
    const part = event.part ?? {};
    if (event.type === "error") {
      sink.fail(event.error?.message ?? "");
    } else if (event.type === "text" && part.type === "text") {
      sink.setText(part.id ?? "text", part.text ?? "");
    } else if (event.type === "step_finish" && part.tokens) {
      const tokens = part.tokens;
      sink.addUsage({
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        cacheRead: tokens.cache?.read ?? 0,
        cacheWrite: tokens.cache?.write ?? 0,
        ...(tokens.reasoning === undefined ? {} : { reasoning: tokens.reasoning }),
      });
    }
  },
  shouldRetry: (detail) => /readiness|server-connection|database is locked/i.test(detail),
};

export function registerOpenCode(msa: ExtensionAPI): void {
  msa.registerProvider(PROVIDER_ID, {
    name: "OpenCode Free",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "local",
    api: "openai-completions",
    models: FREE_MODELS.map((free) => ({
      id: free.id,
      name: free.name,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: free.contextWindow,
      maxTokens: free.maxTokens,
    })),
    streamSimple: ((
      model: Model<string>,
      context: TranscriptContext,
      options?: SimpleStreamOptions,
    ) => streamViaCli(backend, model, context, options)) as never,
  });
}
