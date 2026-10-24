import { Effect } from "effect";

import platform from "../platform/index.ts";
import BashOutputReporter from "./bash-output.ts";
import type bashOutputTypes from "./bash-output.types.ts";
import bashTypesModule from "./bash-types.ts";
import type bashTypes from "./bash.types.ts";
import OutputAccumulator from "./output-accumulator.ts";
import type outputAccumulatorTypes from "./output-accumulator.types.ts";

const { resolveSpawnContext } = bashTypesModule;
const { ToolFailure, fromPromise, nonEmptyOr, unwrapForeign } = platform;

const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024;

const appendStatus = (text: string, status: string): string =>
  `${text === "" ? "" : `${text}\n\n`}${status}`;

interface ShellRun {
  ops: bashTypes.BashOperations;
  config: bashTypes.ShellToolConfig;
  spawnContext: bashTypes.BashSpawnContext;
  timeout: number | undefined;
  signal: AbortSignal | undefined;
  onUpdate: bashOutputTypes.BashUpdateCallback | undefined;
}

const failedExec = (reporter: bashOutputTypes.BashOutputReporter, error: unknown) =>
  Effect.gen(function* () {
    const snapshot = yield* reporter.finish();
    const { text } = reporter.format(snapshot, "");
    if (error instanceof Error && error.message === "aborted") {
      return yield* ToolFailure.make({
        cause: error,
        message: appendStatus(text, "Command aborted"),
      });
    }
    if (error instanceof Error && error.message.startsWith("timeout:")) {
      const timeoutSecs = error.message.split(":")[1];
      return yield* ToolFailure.make({
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
  const execOptions: bashTypes.ExecuteOptions = {
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
    return yield* ToolFailure.make({
      message: appendStatus(outputText, "Command terminated without an exit code"),
    });
  }
  const wallTimeSeconds = Math.round((performance.now() - startedAt) / 100) / 10;
  const fullOutput = yield* fromPromise(() => output.readFullOutput(STRUCTURED_OUTPUT_MAX_BYTES));
  const fullOutputPath = snapshot.fullOutputPath;
  const structuredContent: bashTypes.BashToolOutput = {
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

const shellExecute =
  (
    cwd: string,
    config: bashTypes.ShellToolConfig,
    ops: bashTypes.BashOperations,
    options: bashTypes.BashToolOptions | undefined,
  ): bashTypes.ShellToolDefinition["execute"] =>
  (
    _toolCallId,
    { command, timeout }: { command: string; timeout?: number },
    signal?: AbortSignal,
    onUpdate?,
    ctx?: bashTypes.ShellToolContext,
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

const bashRun = { shellExecute };

export default bashRun;
