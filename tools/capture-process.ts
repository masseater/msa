import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

interface ProcessOptions {
  readonly args: ReadonlyArray<string>;
  readonly command: string;
  readonly cwd: string;
}

interface CaptureResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

class ProcessRunner extends Context.Service<
  ProcessRunner,
  {
    readonly capture: (options: ProcessOptions) => Effect.Effect<CaptureResult>;
    readonly inherit: (options: ProcessOptions) => Effect.Effect<void>;
  }
>()("msa-monorepo/tools/capture-process/ProcessRunner") {}

const processRunnerLayer: Layer.Layer<ProcessRunner> = Layer.effect(
  ProcessRunner,
  Effect.gen(function* () {
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawn = (options: ProcessOptions, inheritStdio: boolean) =>
      spawner.spawn(
        // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
        ChildProcess.make(options.command, options.args, {
          cwd: options.cwd,
          stderr: inheritStdio ? "inherit" : "pipe",
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
)
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  .pipe(Layer.provide(NodeServices.layer));

const captureProcess = (
  options: ProcessOptions,
): Effect.Effect<CaptureResult, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.capture(options));

const runInherit = (options: ProcessOptions): Effect.Effect<void, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.inherit(options));

export type { CaptureResult, ProcessOptions };
export { captureProcess, ProcessRunner, processRunnerLayer, runInherit };
