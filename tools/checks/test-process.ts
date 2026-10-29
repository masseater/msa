import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type testProcessTypes from "./test-process.types.ts";

class ProcessRunner extends Context.Service<
  ProcessRunner,
  {
    readonly capture: (
      options: testProcessTypes.ProcessOptions,
    ) => Effect.Effect<testProcessTypes.CaptureResult>;
    readonly inherit: (options: testProcessTypes.ProcessOptions) => Effect.Effect<void>;
  }
>()("msa-monorepo/tools/checks/test-process/ProcessRunner") {}

const processRunnerLayer: Layer.Layer<ProcessRunner> = Layer.effect(
  ProcessRunner,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawn = (options: testProcessTypes.ProcessOptions, inheritStdio: boolean) =>
      spawner.spawn(
        ChildProcess.make(options.command, options.args, {
          cwd: options.cwd,
          env: options.env,
          extendEnv: true,
          stderr: inheritStdio ? "inherit" : "pipe",
          stdin: inheritStdio ? "inherit" : "ignore",
          stdout: inheritStdio ? "inherit" : "pipe",
        }),
      );
    return ProcessRunner.of({
      capture: (options) =>
        Effect.gen(function* () {
          const child = yield* spawn(options, false);
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              child.stdout.pipe(Stream.decodeText(), Stream.mkString),
              child.stderr.pipe(Stream.decodeText(), Stream.mkString),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { exitCode: Number(exitCode), stderr, stdout };
        }).pipe(Effect.scoped, Effect.orDie),
      inherit: (options) =>
        Effect.gen(function* () {
          const child = yield* spawn(options, true);
          const exitCode = Number(yield* child.exitCode);
          if (exitCode !== 0) {
            return yield* Effect.die(
              new Error(`${options.command} ${options.args.join(" ")} exited with ${exitCode}`),
            );
          }
        }).pipe(Effect.scoped, Effect.orDie),
    });
  }),
).pipe(Layer.provide(NodeServices.layer));

const captureProcess = (
  options: testProcessTypes.ProcessOptions,
): Effect.Effect<testProcessTypes.CaptureResult, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.capture(options));

const runInherit = (
  options: testProcessTypes.ProcessOptions,
): Effect.Effect<void, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.inherit(options));

const testProcess = {
  ProcessRunner,
  captureProcess,
  processRunnerLayer,
  runInherit,
};

export default testProcess;
