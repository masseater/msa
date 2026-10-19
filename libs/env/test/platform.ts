import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, FileSystem, ManagedRuntime, Option, Scope } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export {
  fileExists,
  localPath,
  makeTempDirectory,
  readBytes,
  readText,
  removePath,
  sha256Hex,
  writeText,
} from "../src/platform.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);

const onNode = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, NodeServices.NodeServices>> =>
  Effect.flatMap(runtime.contextEffect, (context) => Effect.provideContext(effect, context));

const withFs = <A>(
  use: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError>,
): Effect.Effect<A> => onNode(Effect.orDie(FileSystem.FileSystem.use(use)));

export const makeDirectory = (path: string): Effect.Effect<void> =>
  withFs((fs) => fs.makeDirectory(path, { recursive: true }));

export interface BytesWrite {
  readonly path: string;
  readonly data: Uint8Array;
}

export const writeBytes = ({ path, data }: BytesWrite): Effect.Effect<void> =>
  withFs((fs) => fs.writeFile(path, data));

export const readNames = (path: string): Effect.Effect<string[]> =>
  withFs((fs) => fs.readDirectory(path));

export const modifiedAt = (path: string): Effect.Effect<number | undefined> =>
  withFs((fs) => fs.stat(path)).pipe(
    Effect.map((info) => Option.getOrUndefined(Option.map(info.mtime, (date) => date.getTime()))),
  );

export const realPath = (path: string): Effect.Effect<string> => withFs((fs) => fs.realPath(path));

const command = ([program = "", ...args]: readonly string[]) =>
  ChildProcess.make(program, args, { detached: false, stdin: "ignore" });

export const runText = (argv: readonly string[]): Effect.Effect<string> =>
  onNode(
    Effect.orDie(
      ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(command(argv))),
    ),
  );

export const runStatus = (argv: readonly string[]): Effect.Effect<number> =>
  onNode(
    Effect.orDie(
      ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.exitCode(command(argv))),
    ),
  ).pipe(Effect.map(Number));

export interface Background {
  readonly stop: Effect.Effect<void>;
}

export const startBackground = ([
  program = "",
  ...args
]: readonly string[]): Effect.Effect<Background> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* onNode(
      Effect.orDie(
        ChildProcess.make(program, args, {
          detached: false,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      ),
    ).pipe(Scope.provide(scope));
    return { stop: Scope.close(scope, Exit.void) };
  });
