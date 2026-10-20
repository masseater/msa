import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
  ToolFailure,
  fromPromise,
  nonEmptyOr,
  platformRuntime,
  unwrapForeign,
} from "../platform/index.ts";
import {
  type BashOperations,
  type ExecuteOptions,
  createLocalBashOperations,
} from "./bash-operations.ts";
import {
  BashOutputReporter,
  type BashToolDetails,
  type BashUpdateCallback,
} from "./bash-output.ts";
import {
  type BashRenderState,
  type BashSpawnContext,
  type BashToolOptions,
  type BashToolOutput,
  type ShellToolConfig,
  bashDescription,
  bashOutputSchema,
  bashSchema,
  bashToolSystemPromptContribution,
  resolveSpawnContext,
} from "./bash-types.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { createShellRenderers } from "./renderers/bash.ts";
import {
  type ConfiguredFactory,
  type CwdFactory,
  configuredFactory,
  cwdFactory,
  wrapToolDefinition,
} from "./tool-definition-wrapper.ts";

export {
  createLocalBashOperations,
  createLocalShellOperations,
  type BashOperations,
} from "./bash-operations.ts";
export type { BashToolDetails } from "./bash-output.ts";
export {
  bashToolSystemPromptContribution,
  type BashRenderState,
  type BashSpawnContext,
  type BashSpawnHook,
  type BashToolInput,
  type BashToolOptions,
  type BashToolOutput,
  type ShellToolConfig,
} from "./bash-types.ts";

const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024;

const appendStatus = (text: string, status: string): string =>
  `${text === "" ? "" : `${text}\n\n`}${status}`;

interface ShellRun {
  ops: BashOperations;
  config: ShellToolConfig;
  spawnContext: BashSpawnContext;
  timeout: number | undefined;
  signal: AbortSignal | undefined;
  onUpdate: BashUpdateCallback | undefined;
}

const failedExec = (reporter: BashOutputReporter, error: unknown) =>
  Effect.gen(function* () {
    const snapshot = yield* reporter.finish();
    const { text } = reporter.format(snapshot, "");
    if (error instanceof Error && error.message === "aborted") {
      return yield* new ToolFailure({
        cause: error,
        message: appendStatus(text, "Command aborted"),
      });
    }
    if (error instanceof Error && error.message.startsWith("timeout:")) {
      const timeoutSecs = error.message.split(":")[1];
      return yield* new ToolFailure({
        cause: error,
        message: appendStatus(text, `Command timed out after ${timeoutSecs} seconds`),
      });
    }
    return yield* fromPromise(() => Promise.reject(error));
  });

const executeShell = Effect.fn("executeShell")(function* (
  run: ShellRun,
  output: OutputAccumulator,
  reporter: BashOutputReporter,
) {
  const startedAt = performance.now();
  const execOptions: ExecuteOptions = {
    env: run.spawnContext.env,
    onData: reporter.handleData,
    signal: run.signal,
    timeout: run.timeout,
  };
  const result = yield* fromPromise(() =>
    run.ops.exec(run.spawnContext.command, run.spawnContext.cwd, execOptions),
  ).pipe(Effect.catchTag("ForeignError", (failure) => failedExec(reporter, failure.cause)));
  const snapshot = yield* reporter.finish();
  const { text: outputText, details } = reporter.format(snapshot);
  const { exitCode } = result;
  if (exitCode === null) {
    return yield* new ToolFailure({
      message: appendStatus(outputText, "Command terminated without an exit code"),
    });
  }
  const wallTimeSeconds = Math.round((performance.now() - startedAt) / 100) / 10;
  const fullOutput = yield* fromPromise(() => output.readFullOutput(STRUCTURED_OUTPUT_MAX_BYTES));
  const fullOutputPath = snapshot.fullOutputPath;
  const structuredContent: BashToolOutput = {
    output: fullOutput.content,
    truncated: fullOutput.truncated,
    ...(fullOutput.truncated && fullOutputPath !== undefined && fullOutputPath !== ""
      ? { full_output_path: fullOutputPath }
      : {}),
    exit_code: exitCode,
    wall_time_seconds: wallTimeSeconds,
  };
  if (exitCode === 0) {
    return { content: [{ text: outputText, type: "text" as const }], details, structuredContent };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: appendStatus(outputText, `Command exited with code ${exitCode}`),
      },
    ],
    details,
    isError: true,
    structuredContent,
  };
});

const runShellTool = (run: ShellRun) =>
  Effect.suspend(() => {
    const output = new OutputAccumulator({ tempFilePrefix: run.config.tempFilePrefix });
    const reporter = new BashOutputReporter(output, run.onUpdate);
    run.onUpdate?.({ content: [], details: undefined });
    return executeShell(run, output, reporter).pipe(
      Effect.ensuring(Effect.sync(() => reporter.clearTimer())),
    );
  });

type ShellToolDefinition = ToolDefinition<
  typeof bashSchema,
  BashToolDetails | undefined,
  BashRenderState
>;

const shellExecute =
  (
    cwd: string,
    config: ShellToolConfig,
    ops: BashOperations,
    options: BashToolOptions | undefined,
  ): ShellToolDefinition["execute"] =>
  (
    _toolCallId,
    { command, timeout }: { command: string; timeout?: number },
    signal?: AbortSignal,
    onUpdate?,
    ctx?: ExtensionContext,
  ) => {
    const commandPrefix = options?.commandPrefix;
    return platformRuntime.runPromise(
      unwrapForeign(
        runShellTool({
          config,
          onUpdate,
          ops,
          signal,
          spawnContext: resolveSpawnContext({
            command:
              commandPrefix === undefined || commandPrefix === ""
                ? command
                : `${commandPrefix}\n${command}`,
            cwd: nonEmptyOr(ctx?.cwd, cwd),
            spawnHook: options?.spawnHook,
            exposeSessionEnvironment: options?.exposeSessionEnvironment ?? true,
            ctx,
          }),
          timeout,
        }),
      ),
    );
  };

const createShellToolDefinitionImpl = (
  cwd: string,
  config: ShellToolConfig,
  options?: BashToolOptions,
): ShellToolDefinition => {
  const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
  const exposeSessionEnvironment = options?.exposeSessionEnvironment ?? true;
  return {
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description: bashDescription(config.shellName),
    execute: shellExecute(cwd, config, ops, options),
    label: config.label,
    name: config.name,
    outputSchema: bashOutputSchema,
    parameters: bashSchema,
    promptGuidelines:
      exposeSessionEnvironment && config.promptGuidelines !== undefined
        ? [...config.promptGuidelines]
        : undefined,
    promptSnippet: config.promptSnippet,
    ...createShellRenderers(config.prompt),
  };
};

export const createShellToolDefinition: ConfiguredFactory<
  ShellToolConfig,
  BashToolOptions,
  ShellToolDefinition
> = configuredFactory(createShellToolDefinitionImpl);

const bashToolConfig: ShellToolConfig = {
  label: "bash",
  name: "bash",
  prompt: "$",
  promptGuidelines: bashToolSystemPromptContribution.guidelines,
  promptSnippet: bashToolSystemPromptContribution.snippet,
  shellName: "bash",
  tempFilePrefix: "msa-bash",
};

export const createBashToolDefinition: CwdFactory<BashToolOptions, ShellToolDefinition> =
  cwdFactory((cwd, options) => createShellToolDefinitionImpl(cwd, bashToolConfig, options));

export const createBashTool: CwdFactory<
  BashToolOptions,
  agentTypes.AgentTool<typeof bashSchema>
> = cwdFactory((cwd, options) => {
  const definition = createShellToolDefinitionImpl(cwd, bashToolConfig, options);
  const tool = wrapToolDefinition(definition);
  Object.assign(tool, {
    promptGuidelines: definition.promptGuidelines,
    promptSnippet: definition.promptSnippet,
  });
  return tool;
});
