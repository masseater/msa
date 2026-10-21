import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
  Deferred,
  Effect,
  FileSystem,
  Layer,
  ManagedRuntime,
  type PlatformError,
  Stream,
} from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

import type platformTypes from "./platform.types.ts";

const layer = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
);

const runtime = ManagedRuntime.make(layer);

const onPlatform = <A>(
  effect: Effect.Effect<A, PlatformError.PlatformError, Layer.Success<typeof layer>>,
): Effect.Effect<A> =>
  Effect.flatMap(runtime.contextEffect, (context) =>
    Effect.provideContext(Effect.orDie(effect), context),
  );

const useFileSystem = <A>(
  use: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError.PlatformError>,
): Effect.Effect<A> => onPlatform(FileSystem.FileSystem.use(use));

const readText = (path: string): Effect.Effect<string> =>
  useFileSystem((fs) => fs.readFileString(path));

const writeText: {
  (text: string): (path: string) => Effect.Effect<void>;
  (path: string, text: string): Effect.Effect<void>;
} = dual(2, (path: string, text: string): Effect.Effect<void> =>
  useFileSystem((fs) => fs.writeFileString(path, text)),
);

const makeDirectory = (path: string): Effect.Effect<void> =>
  useFileSystem((fs) => fs.makeDirectory(path, { recursive: true }));

const removeAll = (path: string): Effect.Effect<void> =>
  useFileSystem((fs) => fs.remove(path, { force: true, recursive: true }));

const listFiles = (directory: string): Effect.Effect<readonly string[]> =>
  useFileSystem((fs) => fs.readDirectory(directory, { recursive: true }));

const collect = (args: readonly string[], cwd: string | undefined) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        process.execPath,
        args,
        cwd === undefined ? {} : { cwd },
      );
      const [stdout, stderr, status] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.mkString(Stream.decodeText(child.stderr)),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { status, stderr, stdout };
    }),
  );

const runNode: {
  (
    options: platformTypes.NodeRunOptions,
  ): (args: readonly string[]) => Effect.Effect<platformTypes.NodeRun>;
  (
    args: readonly string[],
    options: platformTypes.NodeRunOptions,
  ): Effect.Effect<platformTypes.NodeRun>;
} = dual(
  2,
  (
    args: readonly string[],
    options: platformTypes.NodeRunOptions,
  ): Effect.Effect<platformTypes.NodeRun> =>
    onPlatform(collect(args, options.cwd)).pipe(Effect.timeout(options.timeout), Effect.orDie),
);

const holdNode = (args: readonly string[], pid: Deferred.Deferred<number>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(process.execPath, args, {
        detached: false,
        stderr: "ignore",
        stdin: "ignore",
        stdout: "ignore",
      });
      yield* Deferred.succeed(pid, child.pid);
      return yield* Effect.never;
    }),
  );

const startNode = (args: readonly string[]): Effect.Effect<number> =>
  Effect.gen(function* () {
    const pid = yield* Deferred.make<number>();
    yield* Effect.forkDetach(onPlatform(holdNode(args, pid)));
    return yield* Deferred.await(pid);
  });

const platform = {
  listFiles,
  makeDirectory,
  readText,
  removeAll,
  runNode,
  startNode,
  writeText,
};

export default platform;
