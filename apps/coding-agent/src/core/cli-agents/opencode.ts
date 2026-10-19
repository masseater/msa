/**
 * OpenCode Zen free models, each request run by `opencode run --standalone`.
 *
 * Environment overrides:
 *   OPENCODE_BIN             opencode binary (default: ~/.opencode/bin/opencode)
 *   OPENCODE_FREE_DATA_HOME  data dir for these runs (default: ~/.local/share/msa-opencode-free)
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { Provider } from "@msa/ai";
import { getBuiltinModels } from "@msa/ai/providers/all";

import { envSnapshot, readEnv } from "../process-env.ts";
import { cliAgentProvider } from "./provider.ts";
import { streamViaCli, type CliBackend } from "./run.ts";
import { flattenTranscript } from "./transcript.ts";

const PROVIDER_ID = "opencode-free";

function openCodeExecutable(): string {
  return readEnv("OPENCODE_BIN")?.trim() || join(homedir(), ".opencode", "bin", "opencode");
}

/** OpenCode Zen's zero-cost chat models from the bundled models.dev catalog. */
function freeModels() {
  return getBuiltinModels("opencode").filter(
    (model) =>
      model.id.endsWith("-free") &&
      model.cost.input === 0 &&
      model.cost.output === 0 &&
      model.cost.cacheRead === 0 &&
      model.cost.cacheWrite === 0,
  );
}

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
      bin: openCodeExecutable(),
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
        ...envSnapshot(),
        XDG_DATA_HOME:
          readEnv("OPENCODE_FREE_DATA_HOME")?.trim() ||
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

export function openCodeProvider(): Provider {
  return cliAgentProvider({
    id: PROVIDER_ID,
    name: "OpenCode Free",
    models: freeModels().map((free) => ({
      id: free.id,
      name: free.name,
      reasoning: false,
      input: ["text"],
      contextWindow: free.contextWindow,
      maxTokens: free.maxTokens,
    })),
    executable: openCodeExecutable,
    streamSimple: (model, context, options) => streamViaCli(backend, model, context, options),
  });
}
