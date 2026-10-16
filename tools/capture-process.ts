import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

interface CaptureOptions {
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
    readonly capture: (options: CaptureOptions) => Effect.Effect<CaptureResult>;
  }
>()("msa-monorepo/tools/capture-process/ProcessRunner") {}

const processRunnerLayer: Layer.Layer<ProcessRunner> = Layer.effect(
  ProcessRunner,
  Effect.gen(function* () {
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return ProcessRunner.of({
      capture: (options) =>
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
            ChildProcess.make(options.command, options.args, { cwd: options.cwd }),
          );
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
    });
  }),
)
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  .pipe(Layer.provide(NodeServices.layer));

const captureProcess = (
  options: CaptureOptions,
): Effect.Effect<CaptureResult, never, ProcessRunner> =>
  ProcessRunner.use((runner) => runner.capture(options));

export type { CaptureOptions, CaptureResult };
export { captureProcess, ProcessRunner, processRunnerLayer };
