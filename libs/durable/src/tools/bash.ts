import type { Context } from "@msa/chord";
import { Effect } from "effect";
import { Type } from "typebox";

import type envTypes from "../env/index.types.ts";
import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import truncate from "../truncate.ts";
import type bashTypes from "./bash.types.ts";
import envModule from "./env.ts";

const { requireEnv } = envModule;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } = truncate;
const { defineTool } = define;

const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
});

const powershellSchema = Type.Object({
  command: Type.String({ description: "PowerShell command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
});

const shellStructuredOutputSchema = Type.Object({
  exitCode: Type.Number(),
  fullOutputPath: Type.Optional(
    Type.String({ description: "File with the complete output, when it was spilled" }),
  ),
  output: Type.String({
    description: "Combined stdout and stderr: the retained tail, as the model sees it",
  }),
  truncated: Type.Boolean({ description: "Whether earlier output was dropped" }),
});

function validateTimeout(timeout: number | undefined): void {
  if (timeout === undefined) return;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }
  if (timeout > MAX_TIMEOUT_SECONDS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  }
}

const prepareExecution = Effect.fnUntraced(function* (
  command: string,
  options: { commandPrefix?: string; prepare?: bashTypes.BashPrepare } | undefined,
  api: typesModule.ToolExecutionApi,
  context: Context,
) {
  const prefix = options?.commandPrefix;
  const execution: bashTypes.BashExecution = {
    command: prefix === undefined || prefix === "" ? command : `${prefix}\n${command}`,
    cwd: requireEnv(api).cwd,
    env: {},
    inheritEnv: true,
  };
  yield* Effect.promise(() => Promise.resolve(options?.prepare?.(execution, api, context)));
  return execution;
});

type ExecResult = Awaited<ReturnType<envTypes.ExecutionEnv["exec"]>>;

const execFirst = Effect.fnUntraced(function* (
  commands: readonly (string | readonly string[])[],
  execution: bashTypes.BashExecution,
  timeout: number | undefined,
  api: typesModule.ToolExecutionApi,
  context: Context,
) {
  const env = requireEnv(api);
  let result: ExecResult | undefined;
  for (const command of commands) {
    result = yield* Effect.promise(() =>
      env.exec(
        command,
        {
          cwd: execution.cwd,
          env: execution.env,
          inheritEnv: execution.inheritEnv,
          ...(timeout === undefined ? {} : { timeout }),
          onOutput: (text, _context, info) => api.output(text, info.skipped),
          spill: { afterBytes: DEFAULT_MAX_BYTES, afterLines: DEFAULT_MAX_LINES },
          ...(api.outputWindow === undefined ? {} : { window: api.outputWindow }),
        },
        context,
      ),
    );
    if (result.ok || result.error.code !== "spawn_error") break;
  }
  if (result === undefined) throw new Error("No command to run");
  return result;
});

function commandResult(
  result: ExecResult,
  timeout: number | undefined,
  api: typesModule.ToolExecutionApi,
  context: Context,
): typesModule.ToolExecutionResult {
  const spillPath = result.ok ? result.value.spillPath : result.error.spillPath;
  if (spillPath !== undefined) {
    api.diagnostic({ code: "full_output", message: `Full output: ${spillPath}`, severity: "info" });
  }
  if (!result.ok) {
    if (result.error.code === "aborted" && context.abortSignal?.aborted === true)
      throw result.error;
    if (result.error.code === "timeout")
      throw new Error(`Command timed out after ${timeout} seconds`);
    if (result.error.code === "aborted") throw new Error("Command aborted");
    throw result.error;
  }
  const exitCode = result.value.exitCode;
  const retained = api.retainedOutput();
  const structuredOutput: bashTypes.ShellStructuredOutput = {
    output: retained.text,
    truncated: retained.truncated,
    ...(spillPath === undefined ? {} : { fullOutputPath: spillPath }),
    exitCode,
  };
  if (exitCode === 0) return { structuredOutput };
  const exited = {
    code: "exit_code",
    message: `Command exited with code ${exitCode}`,
    severity: "error",
  } as const;
  return { diagnostics: [exited], isError: true, structuredOutput };
}

function createBashTool(
  options?: bashTypes.BashToolOptions,
): typesModule.ToolRegistration<typeof bashSchema> {
  return defineTool({
    description: `Execute a bash command in the current working directory. Returns combined stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    execute(args, api, context) {
      return Effect.runPromise(
        Effect.gen(function* () {
          validateTimeout(args.timeout);
          const execution = yield* prepareExecution(args.command, options, api, context);
          const result = yield* execFirst(
            [execution.command],
            execution,
            args.timeout,
            api,
            context,
          );
          return commandResult(result, args.timeout, api, context);
        }),
      );
    },
    name: "bash",
    outputLimits: { retain: "tail" },
    parameters: bashSchema,
    structuredOutputSchema: shellStructuredOutputSchema,
  });
}

const UTF8_OUTPUT = "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}";
const POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
] as const;

function createPowerShellTool(
  options?: bashTypes.PowerShellToolOptions,
): typesModule.ToolRegistration<typeof powershellSchema> {
  const programs = options?.programs ?? ["pwsh", "powershell"];
  return defineTool({
    description: `Execute a PowerShell command in the current working directory. Returns combined stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    execute(args, api, context) {
      return Effect.runPromise(
        Effect.gen(function* () {
          validateTimeout(args.timeout);
          const execution = yield* prepareExecution(args.command, options, api, context);
          const script = `${UTF8_OUTPUT}\n${execution.command}`;
          const commands = programs.map((program) => [program].concat(POWERSHELL_ARGS, script));
          const result = yield* execFirst(commands, execution, args.timeout, api, context);
          return commandResult(result, args.timeout, api, context);
        }),
      );
    },
    name: "powershell",
    outputLimits: { retain: "tail" },
    parameters: powershellSchema,
    structuredOutputSchema: shellStructuredOutputSchema,
  });
}

const bash = {
  bashSchema,
  createBashTool,
  createPowerShellTool,
  powershellSchema,
  shellStructuredOutputSchema,
};

export default bash;
