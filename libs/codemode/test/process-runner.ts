import { NodeServices } from "@effect/platform-node";
import { Data, Effect, ManagedRuntime, Option, Stream } from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

class FixtureError extends Data.TaggedError("FixtureError")<{ readonly message: string }> {}

type Stdio = "ignore" | "inherit" | "pipe";

interface SpawnOptions {
  readonly stdin: Stdio;
  readonly stdout: Stdio;
  readonly stderr: Stdio;
}

const runtime = ManagedRuntime.make(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- ChildProcess (effect/unstable) is the only Effect API for spawning processes
  NodeServices.layer,
);

const spawn = (command: string, args: string[], options: SpawnOptions) =>
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- ChildProcess (effect/unstable) is the only Effect API for spawning processes
  ChildProcess.make(command, args, options);

export const isAvailable = (command: string): Promise<boolean> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawn(command, ["--version"], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });
        return (yield* handle.exitCode) === 0;
      }),
    ).pipe(
      Effect.timeout(5000),
      Effect.orElseSucceed(() => false),
    ),
  );

export const firstLine: {
  (args: string[]): (command: string) => Promise<string[]>;
  (command: string, args: string[]): Promise<string[]>;
} = dual(2, (command: string, args: string[]): Promise<string[]> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawn(command, args, {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "inherit",
        });
        const line = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runHead,
        );
        if (Option.isSome(line)) return [line.value.trim()];
        const code = yield* handle.exitCode;
        return yield* new FixtureError({ message: `${command} exited with ${code} before output` });
      }),
    ),
  ),
);

export const allLines: {
  (args: string[]): (command: string) => Promise<string[]>;
  (command: string, args: string[]): Promise<string[]>;
} = dual(2, (command: string, args: string[]): Promise<string[]> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawn(command, args, {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "inherit",
        });
        const stdout = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const code = yield* handle.exitCode;
        if (code !== 0)
          return yield* new FixtureError({ message: `${command} exited with ${code}` });
        return stdout.trim().split(/\r?\n/u);
      }),
    ).pipe(Effect.timeout(20000)),
  ),
);
