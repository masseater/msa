import { Type } from "typebox";

import shell from "../../utils/shell.ts";
import type bashTypesTypes from "./bash-types.types.ts";
import truncate from "./truncate.ts";

const { getShellEnv } = shell;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } = truncate;

const bashSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
});

const bashToolSystemPromptContribution = {
  guidelines: [
    "You can inspect MSA_* environment variables for current model and session details.",
  ],
  snippet: "Execute bash commands (ls, grep, find, etc.)",
} as const;

const bashOutputSchema = Type.Object({
  exit_code: Type.Number(),
  full_output_path: Type.Optional(Type.String({ description: "Full output, when truncated" })),
  output: Type.String({ description: "Combined stdout and stderr, possibly truncated" }),
  truncated: Type.Boolean(),
  wall_time_seconds: Type.Number(),
});

const SESSION_ENV_KEYS = [
  "MSA_SESSION_ID",
  "MSA_SESSION_FILE",
  "MSA_PROVIDER",
  "MSA_MODEL",
  "MSA_REASONING_LEVEL",
] as const;

function resolveSpawnContext({
  command,
  cwd,
  spawnHook,
  exposeSessionEnvironment,
  ctx,
}: bashTypesTypes.SpawnContextInput): bashTypesTypes.BashSpawnContext {
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
  const baseContext: bashTypesTypes.BashSpawnContext = { command, cwd, env };
  return spawnHook === undefined ? baseContext : spawnHook(baseContext);
}

const bashDescription = (shellName: string): string =>
  `Execute a ${shellName} command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`;

const bashTypes = {
  bashDescription,
  bashOutputSchema,
  bashSchema,
  bashToolSystemPromptContribution,
  resolveSpawnContext,
};

export default bashTypes;
