import type { Fiber } from "effect";
import { type Static, Type } from "typebox";

import { getShellEnv } from "../../utils/shell.ts";
import type { ExtensionContext } from "../extensions/types.ts";
import type { BashOperations } from "./bash-operations.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./truncate.ts";

export const bashSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
});

export const bashToolSystemPromptContribution = {
  guidelines: [
    "You can inspect MSA_* environment variables for current model and session details.",
  ],
  snippet: "Execute bash commands (ls, grep, find, etc.)",
} as const;

export type BashToolInput = Static<typeof bashSchema>;

export const bashOutputSchema = Type.Object({
  exit_code: Type.Number(),
  full_output_path: Type.Optional(Type.String({ description: "Full output, when truncated" })),
  output: Type.String({ description: "Combined stdout and stderr, possibly truncated" }),
  truncated: Type.Boolean(),
  wall_time_seconds: Type.Number(),
});

export type BashToolOutput = Static<typeof bashOutputSchema>;

export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

const SESSION_ENV_KEYS = [
  "MSA_SESSION_ID",
  "MSA_SESSION_FILE",
  "MSA_PROVIDER",
  "MSA_MODEL",
  "MSA_REASONING_LEVEL",
] as const;

export interface SpawnContextInput {
  command: string;
  cwd: string;
  spawnHook: BashSpawnHook | undefined;
  exposeSessionEnvironment: boolean;
  ctx: ExtensionContext | undefined;
}

export function resolveSpawnContext({
  command,
  cwd,
  spawnHook,
  exposeSessionEnvironment,
  ctx,
}: SpawnContextInput): BashSpawnContext {
  const env = { ...getShellEnv() };
  for (const key of SESSION_ENV_KEYS) delete env[key];
  if (exposeSessionEnvironment && ctx !== undefined) {
    const model = ctx.model;
    env["MSA_SESSION_ID"] = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile !== undefined && sessionFile !== "") env["MSA_SESSION_FILE"] = sessionFile;
    if (model !== undefined) {
      env["MSA_PROVIDER"] = model.provider;
      env["MSA_MODEL"] = model.id;
    }
    if (ctx.thinkingLevel !== undefined) env["MSA_REASONING_LEVEL"] = ctx.thinkingLevel;
  }
  const baseContext: BashSpawnContext = { command, cwd, env };
  return spawnHook === undefined ? baseContext : spawnHook(baseContext);
}

export interface BashToolOptions {
  operations?: BashOperations;
  commandPrefix?: string | undefined;
  shellPath?: string | undefined;
  exposeSessionEnvironment?: boolean;
  spawnHook?: BashSpawnHook;
}

export type BashRenderState = {
  startedAt: number | undefined;
  endedAt: number | undefined;
  interval: Fiber.Fiber<never> | undefined;
};

export interface ShellToolConfig {
  name: string;
  label: string;
  shellName: string;
  prompt: string;
  promptSnippet: string;
  promptGuidelines?: readonly string[];
  tempFilePrefix: string;
}

export const bashDescription = (shellName: string): string =>
  `Execute a ${shellName} command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`;
