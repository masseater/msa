import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/process";

export const captureProcess = (options: {
  readonly args: ReadonlyArray<string>;
  readonly command: string;
  readonly cwd: string;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
      const child = yield* ChildProcess.make(options.command, options.args, { cwd: options.cwd });
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { exitCode: Number(exitCode), stderr, stdout };
    }),
  );
