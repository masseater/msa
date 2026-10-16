import { runMain } from "@effect/platform-node/NodeRuntime";
import { layer as nodeServicesLayer } from "@effect/platform-node/NodeServices";
import {
  Array as Arr,
  Cause,
  Config,
  Data,
  Effect,
  Exit,
  FileSystem,
  Function as Fn,
  Layer,
  Option,
  Path,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { HookPlatform } from "./platform.ts";
import type { CommandResult, Sink } from "./platform.ts";

class HookBlocked extends Data.TaggedError("HookBlocked")<{ readonly reason: string }> {}

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_BLOCKING = 2;
const DATA_FIRST_ARITY = 2;

const projectDir = Config.String("CLAUDE_PROJECT_DIR").pipe(Config.withDefault("."));

const projectRoot = Effect.gen(function* projectRoot() {
  const platform = yield* HookPlatform;
  return platform.resolve(yield* projectDir);
});

const localBin = Effect.fn("localBin")(function* localBin(name: string) {
  const platform = yield* HookPlatform;
  return platform.join(yield* projectRoot, "node_modules", ".bin", name);
});

const blockWhen = (reasons: readonly string[]): Effect.Effect<void, HookBlocked> => {
  if (!Arr.isReadonlyArrayNonEmpty(reasons)) {
    return Effect.void;
  }
  return Effect.fail(new HookBlocked({ reason: reasons.join("\n") }));
};

const writeTo = (sink: Sink, text: string): Effect.Effect<void, never, HookPlatform> =>
  Effect.gen(function* write() {
    const platform = yield* HookPlatform;
    yield* platform.write(sink, text);
  });

const writeJson: {
  <Codec extends Schema.Top>(
    value: Codec["Type"],
  ): (schema: Codec) => Effect.Effect<void, never, HookPlatform | Codec["EncodingServices"]>;
  <Codec extends Schema.Top>(
    schema: Codec,
    value: Codec["Type"],
  ): Effect.Effect<void, never, HookPlatform | Codec["EncodingServices"]>;
} = Fn.dual(DATA_FIRST_ARITY, <Codec extends Schema.Top>(schema: Codec, value: Codec["Type"]) =>
  Schema.encodeEffect(Schema.fromJsonString(schema))(value).pipe(
    Effect.orDie,
    Effect.flatMap((text) => writeTo("stdout", text)),
  ),
);

const readHookInput = <Codec extends Schema.Top>(
  schema: Codec,
): Effect.Effect<Codec["Type"], Schema.SchemaError, HookPlatform | Codec["DecodingServices"]> =>
  Effect.gen(function* read() {
    const platform = yield* HookPlatform;
    const text = yield* platform.readStdin;
    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(text);
  });

const spawnCommand = (
  command: string,
  args: readonly string[],
): Effect.Effect<CommandResult, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* run() {
    const dir = yield* projectDir.pipe(Effect.orDie);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd: dir }));
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText, Stream.mkString),
        handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        handle.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return { succeeded: exitCode === EXIT_SUCCESS, stdout, output: `${stdout}${stderr}` };
  }).pipe(
    Effect.scoped,
    Effect.catchTag("PlatformError", (failure) =>
      Effect.succeed({ succeeded: false, stdout: "", output: failure.message }),
    ),
  );

const platformLayer = Layer.effect(
  HookPlatform,
  Effect.gen(function* platform() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stdio = yield* Stdio.Stdio;
    return HookPlatform.of({
      runCommand: (command, args) =>
        spawnCommand(command, args).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      readStdin: stdio.stdin.pipe(Stream.decodeText, Stream.mkString, Effect.orDie),
      write: (sink, text) => Stream.make(text).pipe(Stream.run(stdio[sink]()), Effect.orDie),
      exists: (file) => fs.exists(file).pipe(Effect.orDie),
      readFile: (file) => fs.readFileString(file).pipe(Effect.option),
      resolve: (...segments) => path.resolve(...segments),
      join: (...segments) => path.join(...segments),
      relative: (from, to) => path.relative(from, to),
      sep: path.sep,
    });
  }),
);

const hookLayer = platformLayer.pipe(Layer.provideMerge(nodeServicesLayer));

const runCommand: {
  (args: readonly string[]): (command: string) => Effect.Effect<CommandResult, never, HookPlatform>;
  (command: string, args: readonly string[]): Effect.Effect<CommandResult, never, HookPlatform>;
} = Fn.dual(DATA_FIRST_ARITY, (command: string, args: readonly string[]) =>
  Effect.gen(function* run() {
    const platform = yield* HookPlatform;
    return yield* platform.runCommand(command, args);
  }),
);

const findBlocked = <Failure>(cause: Cause.Cause<Failure>): Option.Option<HookBlocked> =>
  Cause.findErrorOption(cause).pipe(
    Option.filter((error): error is Failure & HookBlocked => error instanceof HookBlocked),
  );

const exitCodeOf = <Value, Failure>(exit: Exit.Exit<Value, Failure>): number => {
  if (Exit.isSuccess(exit)) {
    return EXIT_SUCCESS;
  }
  if (Option.isSome(findBlocked(exit.cause))) {
    return EXIT_BLOCKING;
  }
  return EXIT_FAILURE;
};

const reportFailure = <Failure>(
  cause: Cause.Cause<Failure>,
): Effect.Effect<void, never, HookPlatform> =>
  writeTo(
    "stderr",
    `${Option.match(findBlocked(cause), {
      onNone: () => Cause.pretty(cause),
      onSome: (blocked) => blocked.reason,
    })}\n`,
  );

const runHookWith =
  <Provided, LayerFailure>(layer: Layer.Layer<Provided, LayerFailure, HookPlatform>) =>
  <Value, Failure>(program: Effect.Effect<Value, Failure, HookPlatform | Provided>): void => {
    const reported = program.pipe(Effect.tapCause(reportFailure));
    const main = Layer.build(Layer.provideMerge(layer, hookLayer)).pipe(
      Effect.flatMap((context) => Effect.provideContext(reported, context)),
      Effect.scoped,
    );
    runMain(main, {
      disableErrorReporting: true,
      teardown: (exit, onExit) => {
        onExit(exitCodeOf(exit));
      },
    });
  };

const runHook = runHookWith(Layer.empty);

export type { HookBlocked };
export { blockWhen, localBin, projectRoot, readHookInput, runCommand, runHook, writeJson };
