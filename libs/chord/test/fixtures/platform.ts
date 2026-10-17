import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
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
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:child_process has no stable Effect replacement
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
    NodeFileSystem.layer,
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:path has no stable Effect replacement
    NodePath.layer,
  ),
);

const runtime = ManagedRuntime.make(layer);

const onPlatform = <A>(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  effect: Effect.Effect<A, PlatformError.PlatformError, Layer.Success<typeof layer>>,
): Effect.Effect<A> =>
  Effect.flatMap(runtime.contextEffect, (context) =>
    Effect.provideContext(Effect.orDie(effect), context),
  );

const useFileSystem = <A>(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  use: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError.PlatformError>,
): Effect.Effect<A> =>
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  onPlatform(FileSystem.FileSystem.use(use));

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
      // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:child_process has no stable Effect replacement
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
