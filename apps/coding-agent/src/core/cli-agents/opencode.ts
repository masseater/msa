import { homedir } from "node:os";

import type aiTypes from "@msa/ai/index.types";
import all from "@msa/ai/providers/all";

import nodePath from "../platform/node/path.ts";
import processEnv from "../process-env.ts";
import provider from "./provider.ts";
import run from "./run.ts";
import type runTypes from "./run.types.ts";
import transcript from "./transcript.ts";

const { join } = nodePath;

const { envSnapshot, readEnv } = processEnv;
const { flattenTranscript } = transcript;
const { streamViaCli } = run;
const { cliAgentProvider } = provider;

const { getBuiltinModels } = all;

const PROVIDER_ID = "opencode-free";

function openCodeExecutable(): string {
  return readEnv("OPENCODE_BIN")?.trim() || join(homedir(), ".opencode", "bin", "opencode");
}

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

const backend: runTypes.CliBackend<OpenCodeEvent> = {
  command(model, context, cwd) {
    return {
      args: [
        "run",
        "--standalone",
        "--auto",
        "--format",
        "json",
        "--model",
        `opencode/${model.id}`,
      ],
      bin: openCodeExecutable(),
      env: {
        ...envSnapshot(),
        XDG_DATA_HOME:
          readEnv("OPENCODE_FREE_DATA_HOME")?.trim() ||
          join(homedir(), ".local", "share", "msa-opencode-free"),
      },
      stdin: buildPrompt(context.messages, cwd),
    };
  },
  handleEvent(event, sink) {
    const part = event.part ?? {};
    if (event.type === "error") {
      sink.fail(event.error?.message ?? "");
    } else if (event.type === "text" && part.type === "text") {
      sink.setText(part.id ?? "text", part.text ?? "");
    } else if (event.type === "step_finish" && part.tokens !== undefined) {
      const tokens = part.tokens;
      sink.addUsage({
        cacheRead: tokens.cache?.read ?? 0,
        cacheWrite: tokens.cache?.write ?? 0,
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        ...(tokens.reasoning === undefined ? {} : { reasoning: tokens.reasoning }),
      });
    }
  },
  providerId: PROVIDER_ID,
  shouldRetry: (detail) => /readiness|server-connection|database is locked/iu.test(detail),
};

function openCodeProvider(): aiTypes.Provider {
  return cliAgentProvider({
    executable: openCodeExecutable,
    id: PROVIDER_ID,
    models: freeModels().map((free) => ({
      contextWindow: free.contextWindow,
      id: free.id,
      input: ["text"],
      maxTokens: free.maxTokens,
      name: free.name,
      reasoning: false,
    })),
    name: "OpenCode Free",
    streamSimple: (model, context, options) => streamViaCli(backend, model, context, options),
  });
}

const opencode = {
  openCodeProvider,
};

export default opencode;
