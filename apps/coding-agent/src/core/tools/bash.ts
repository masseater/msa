import type { AgentTool } from "@msa/agent-core";
import { Effect } from "effect";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
  fromPromise,
  nonEmptyOr,
  platformRuntime,
  ToolFailure,
  unwrapForeign,
} from "../platform/index.ts";
import {
  type BashOperations,
  createLocalBashOperations,
  type ExecuteOptions,
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
  bashDescription,
  bashOutputSchema,
  bashSchema,
  bashToolSystemPromptContribution,
  resolveSpawnContext,
  type ShellToolConfig,
} from "./bash-types.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { createShellRenderers } from "./renderers/bash.ts";
import {
  type ConfiguredFactory,
  configuredFactory,
  type CwdFactory,
  cwdFactory,
  wrapToolDefinition,
} from "./tool-definition-wrapper.ts";

export {
  type BashOperations,
  createLocalBashOperations,
  createLocalShellOperations,
} from "./bash-operations.ts";
export type { BashToolDetails } from "./bash-output.ts";
export {
  type BashRenderState,
  type BashSpawnContext,
  type BashSpawnHook,
  type BashToolInput,
  type BashToolOptions,
  type BashToolOutput,
  bashToolSystemPromptContribution,
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
        message: appendStatus(text, "Command aborted"),
        cause: error,
      });
    }
    if (error instanceof Error && error.message.startsWith("timeout:")) {
      const timeoutSecs = error.message.split(":")[1];
      return yield* new ToolFailure({
        message: appendStatus(text, `Command timed out after ${timeoutSecs} seconds`),
        cause: error,
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
    onData: reporter.handleData,
    signal: run.signal,
    timeout: run.timeout,
    env: run.spawnContext.env,
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
    return { content: [{ type: "text" as const, text: outputText }], details, structuredContent };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: appendStatus(outputText, `Command exited with code ${exitCode}`),
      },
    ],
    details,
    structuredContent,
    isError: true,
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
          ops,
          config,
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
          signal,
          onUpdate,
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
    name: config.name,
    label: config.label,
    description: bashDescription(config.shellName),
    promptSnippet: config.promptSnippet,
    promptGuidelines:
      exposeSessionEnvironment && config.promptGuidelines !== undefined
        ? [...config.promptGuidelines]
        : undefined,
    parameters: bashSchema,
    outputSchema: bashOutputSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    execute: shellExecute(cwd, config, ops, options),
    ...createShellRenderers(config.prompt),
  };
};

export const createShellToolDefinition: ConfiguredFactory<
  ShellToolConfig,
  BashToolOptions,
  ShellToolDefinition
> = configuredFactory(createShellToolDefinitionImpl);

const bashToolConfig: ShellToolConfig = {
  name: "bash",
  label: "bash",
  shellName: "bash",
  prompt: "$",
  promptSnippet: bashToolSystemPromptContribution.snippet,
  promptGuidelines: bashToolSystemPromptContribution.guidelines,
  tempFilePrefix: "msa-bash",
};

export const createBashToolDefinition: CwdFactory<BashToolOptions, ShellToolDefinition> =
  cwdFactory((cwd, options) => createShellToolDefinitionImpl(cwd, bashToolConfig, options));

export const createBashTool: CwdFactory<BashToolOptions, AgentTool<typeof bashSchema>> = cwdFactory(
  (cwd, options) => {
    const definition = createShellToolDefinitionImpl(cwd, bashToolConfig, options);
    const tool = wrapToolDefinition(definition);
    Object.assign(tool, {
      promptSnippet: definition.promptSnippet,
      promptGuidelines: definition.promptGuidelines,
    });
    return tool;
  },
);
