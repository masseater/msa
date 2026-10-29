import { Context, Effect, Layer } from "effect";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import type captureProcessTypes from "./capture-process.types.ts";

const { ScriptOutput, scriptOutputLayer } = scriptOutput;

const commandLabel = (command: captureProcessTypes.ProcessOptions["command"]) =>
  typeof command === "string" ? command : command.msaBinary;

class ProcessRunner extends Context.Service<
  ProcessRunner,
  {
    readonly capture: (
      options: captureProcessTypes.ProcessOptions,
    ) => Effect.Effect<captureProcessTypes.CaptureResult>;
    readonly inherit: (options: captureProcessTypes.ProcessOptions) => Effect.Effect<void>;
  }
>()("msa-monorepo/tools/capture-process/ProcessRunner") {}

const processRunnerLayer: Layer.Layer<ProcessRunner> = Layer.effect(
  ProcessRunner,
  Effect.gen(function* () {
    const { processes } = yield* ScriptOutput;
    return ProcessRunner.of({
      capture: (options) => processes.run(options),
      inherit: (options) =>
        Effect.gen(function* () {
          const child = yield* processes.spawn({
            ...options,
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          });
          const exitCode = yield* child.exitCode;
          if (exitCode !== 0) {
            return yield* Effect.die(
              new Error(
                `${commandLabel(options.command)} ${options.args.join(" ")} exited with ${exitCode}`,
              ),
            );
          }
        }).pipe(Effect.scoped),
    });
  }),
).pipe(Layer.provide(scriptOutputLayer));

const captureProcess = (
  options: captureProcessTypes.ProcessOptions,
): Effect.Effect<captureProcessTypes.CaptureResult, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.capture(options));

const runInherit = (
  options: captureProcessTypes.ProcessOptions,
): Effect.Effect<void, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.inherit(options));

const captureProcessModule = {
  ProcessRunner,
  captureProcess,
  processRunnerLayer,
  runInherit,
};

export default captureProcessModule;
