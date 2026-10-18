import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
  Deferred,
  type Duration,
  Effect,
  FileSystem,
  Layer,
  ManagedRuntime,
  type PlatformError,
  Stream,
} from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

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

export const readText = (path: string): Effect.Effect<string> =>
  useFileSystem((fs) => fs.readFileString(path));

export const writeText: {
  (text: string): (path: string) => Effect.Effect<void>;
  (path: string, text: string): Effect.Effect<void>;
} = dual(2, (path: string, text: string): Effect.Effect<void> =>
  useFileSystem((fs) => fs.writeFileString(path, text)),
);

export const makeDirectory = (path: string): Effect.Effect<void> =>
  useFileSystem((fs) => fs.makeDirectory(path, { recursive: true }));

export const removeAll = (path: string): Effect.Effect<void> =>
  useFileSystem((fs) => fs.remove(path, { recursive: true, force: true }));

export const listFiles = (directory: string): Effect.Effect<readonly string[]> =>
  useFileSystem((fs) => fs.readDirectory(directory, { recursive: true }));

export interface NodeRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface NodeRunOptions {
  readonly timeout: Duration.Input;
  readonly cwd?: string;
}

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
      return { status, stdout, stderr };
    }),
  );

export const runNode: {
  (options: NodeRunOptions): (args: readonly string[]) => Effect.Effect<NodeRun>;
  (args: readonly string[], options: NodeRunOptions): Effect.Effect<NodeRun>;
} = dual(2, (args: readonly string[], options: NodeRunOptions): Effect.Effect<NodeRun> =>
  onPlatform(collect(args, options.cwd)).pipe(Effect.timeout(options.timeout), Effect.orDie),
);

const holdNode = (args: readonly string[], pid: Deferred.Deferred<number>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(process.execPath, args, {
        detached: false,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      yield* Deferred.succeed(pid, child.pid);
      return yield* Effect.never;
    }),
  );

export const startNode = (args: readonly string[]): Effect.Effect<number> =>
  Effect.gen(function* () {
    const pid = yield* Deferred.make<number>();
    yield* Effect.forkDetach(onPlatform(holdNode(args, pid)));
    return yield* Deferred.await(pid);
  });
