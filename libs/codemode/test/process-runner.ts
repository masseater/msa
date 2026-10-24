import { NodeServices } from "@effect/platform-node";
import { Effect, ManagedRuntime, Option, Schema, Stream } from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

class FixtureError extends Schema.TaggedError<FixtureError, { readonly brand: unique symbol }>()(
  "FixtureError",
  { message: Schema.String },
) {}

type Stdio = "ignore" | "inherit" | "pipe";

interface SpawnOptions {
  readonly stdin: Stdio;
  readonly stdout: Stdio;
  readonly stderr: Stdio;
}

const runtime = ManagedRuntime.make(NodeServices.layer);

const spawn = (command: string, args: string[], options: SpawnOptions) =>
  ChildProcess.make(command, args, options);

const isAvailable = (command: string): Promise<boolean> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawn(command, ["--version"], {
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        });
        return (yield* handle.exitCode) === 0;
      }),
    ).pipe(
      Effect.timeout(5000),
      Effect.orElseSucceed(() => false),
    ),
  );

const firstLine: {
  (args: string[]): (command: string) => Promise<string[]>;
  (command: string, args: string[]): Promise<string[]>;
} = dual(2, (command: string, args: string[]): Promise<string[]> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawn(command, args, {
          stderr: "inherit",
          stdin: "ignore",
          stdout: "pipe",
        });
        const line = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runHead,
        );
        if (Option.isSome(line)) return [line.value.trim()];
        const code = yield* handle.exitCode;
        return yield* FixtureError.make({
          message: `${command} exited with ${code} before output`,
        });
      }),
    ),
  ),
);

const allLines: {
  (args: string[]): (command: string) => Promise<string[]>;
  (command: string, args: string[]): Promise<string[]>;
} = dual(2, (command: string, args: string[]): Promise<string[]> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawn(command, args, {
          stderr: "inherit",
          stdin: "pipe",
          stdout: "pipe",
        });
        const stdout = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const code = yield* handle.exitCode;
        if (code !== 0)
          return yield* FixtureError.make({ message: `${command} exited with ${code}` });
        return stdout.trim().split(/\r?\n/u);
      }),
    ).pipe(Effect.timeout(20000)),
  ),
);

const processRunner = {
  allLines,
  firstLine,
  isAvailable,
};

export default processRunner;
