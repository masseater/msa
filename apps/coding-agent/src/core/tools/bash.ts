import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import bashOperations from "./bash-operations.ts";
import type bashOperationsTypes from "./bash-operations.types.ts";
import BashOutputReporter from "./bash-output.ts";
import type bashOutputTypes from "./bash-output.types.ts";
import bashTypesModule from "./bash-types.ts";
import type bashTypesTypes from "./bash-types.types.ts";
import OutputAccumulator from "./output-accumulator.ts";
import type outputAccumulatorTypes from "./output-accumulator.types.ts";
import bashModule from "./renderers/bash.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const { createLocalBashOperations } = bashOperations;
const {
  bashDescription,
  bashOutputSchema,
  bashSchema,
  bashToolSystemPromptContribution,
  resolveSpawnContext,
} = bashTypesModule;
const { ToolFailure, fromPromise, nonEmptyOr, unwrapForeign } = platform;
const { createShellRenderers } = bashModule;
const { configuredFactory, cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024;

const appendStatus = (text: string, status: string): string =>
  `${text === "" ? "" : `${text}\n\n`}${status}`;

interface ShellRun {
  ops: bashOperationsTypes.BashOperations;
  config: bashTypesTypes.ShellToolConfig;
  spawnContext: bashTypesTypes.BashSpawnContext;
  timeout: number | undefined;
  signal: AbortSignal | undefined;
  onUpdate: bashOutputTypes.BashUpdateCallback | undefined;
}

const failedExec = (reporter: bashOutputTypes.BashOutputReporter, error: unknown) =>
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
  output: outputAccumulatorTypes.OutputAccumulator,
  reporter: bashOutputTypes.BashOutputReporter,
) {
  const startedAt = performance.now();
  const execOptions: bashOperationsTypes.ExecuteOptions = {
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
  const structuredContent: bashTypesTypes.BashToolOutput = {
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
        text: appendStatus(outputText, `Command exited with code ${exitCode}`),
        type: "text" as const,
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

type ShellToolDefinition = extensionsTypesTypes.ToolDefinition<
  typeof bashSchema,
  bashOutputTypes.BashToolDetails | undefined,
  bashTypesTypes.BashRenderState
>;

const shellExecute =
  (
    cwd: string,
    config: bashTypesTypes.ShellToolConfig,
    ops: bashOperationsTypes.BashOperations,
    options: bashTypesTypes.BashToolOptions | undefined,
  ): ShellToolDefinition["execute"] =>
  (
    _toolCallId,
    { command, timeout }: { command: string; timeout?: number },
    signal?: AbortSignal,
    onUpdate?,
    ctx?: extensionsTypesTypes.ExtensionContext,
  ) => {
    const commandPrefix = options?.commandPrefix;
    return Effect.runPromise(
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
            ctx,
            cwd: nonEmptyOr(ctx?.cwd, cwd),
            exposeSessionEnvironment: options?.exposeSessionEnvironment ?? true,
            spawnHook: options?.spawnHook,
          }),
          timeout,
        }),
      ),
    );
  };

const createShellToolDefinitionImpl = (
  cwd: string,
  config: bashTypesTypes.ShellToolConfig,
  options?: bashTypesTypes.BashToolOptions,
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

const createShellToolDefinition: toolDefinitionWrapperTypes.ConfiguredFactory<
  bashTypesTypes.ShellToolConfig,
  bashTypesTypes.BashToolOptions,
  ShellToolDefinition
> = configuredFactory(createShellToolDefinitionImpl);

const bashToolConfig: bashTypesTypes.ShellToolConfig = {
  label: "bash",
  name: "bash",
  prompt: "$",
  promptGuidelines: bashToolSystemPromptContribution.guidelines,
  promptSnippet: bashToolSystemPromptContribution.snippet,
  shellName: "bash",
  tempFilePrefix: "msa-bash",
};

const createBashToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  bashTypesTypes.BashToolOptions,
  ShellToolDefinition
> = cwdFactory((cwd, options) => createShellToolDefinitionImpl(cwd, bashToolConfig, options));

const createBashTool: toolDefinitionWrapperTypes.CwdFactory<
  bashTypesTypes.BashToolOptions,
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

const bash = {
  bashToolSystemPromptContribution: bashTypesModule.bashToolSystemPromptContribution,
  createBashTool,
  createBashToolDefinition,
  createLocalBashOperations: bashOperations.createLocalBashOperations,
  createLocalShellOperations: bashOperations.createLocalShellOperations,
  createShellToolDefinition,
};

export default bash;
