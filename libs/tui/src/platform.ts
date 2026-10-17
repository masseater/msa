import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Context, Effect, FileSystem, Layer, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { PlatformFailure } from "./platform-failure.ts";

export { PlatformFailure } from "./platform-failure.ts";

export interface CommandRequest {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface PathOperations {
  readonly join: (...segments: ReadonlyArray<string>) => string;
  readonly dirname: (path: string) => string;
  readonly basename: (path: string, suffix?: string) => string;
  readonly isAbsolute: (path: string) => boolean;
  readonly resolve: (...segments: ReadonlyArray<string>) => string;
}

export class Platform extends Context.Service<
  Platform,
  {
    readonly isDirectory: (path: string) => Effect.Effect<boolean>;
    readonly readDirectory: (path: string) => Effect.Effect<ReadonlyArray<string>, PlatformFailure>;
    readonly runCommand: (request: CommandRequest) => Effect.Effect<CommandResult, PlatformFailure>;
  }
>()("@msa/tui/platform") {}

const failWith =
  (operation: string) =>
  (cause: unknown): PlatformFailure =>
    new PlatformFailure({ operation, cause });

const platformServices = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const makePlatform = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return Platform.of({
    isDirectory: (path) =>
      fs.stat(path).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      ),
    readDirectory: (path) =>
      fs.readDirectory(path).pipe(Effect.mapError(failWith("readDirectory"))),
    runCommand: ({ file, args }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(file, [...args], {
              detached: false,
              killSignal: "SIGKILL",
              stdin: "ignore",
            }),
          );
          const [stdout, exitCode] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
            { concurrency: 2 },
          );
          return { exitCode, stdout };
        }),
      ).pipe(Effect.mapError(failWith("runCommand"))),
  });
});

const platformLayer = Layer.effect(Platform, makePlatform).pipe(
  Layer.provide(NodeChildProcessSpawner.layer),
  Layer.provide(platformServices),
);

export const platformRuntime: ManagedRuntime.ManagedRuntime<Platform, never> =
  ManagedRuntime.make(platformLayer);

const nodePath = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

export const pathOperations: PathOperations = {
  join: (...segments) => nodePath.join(...segments),
  dirname: (path) => nodePath.dirname(path),
  basename: (path, suffix) => nodePath.basename(path, suffix),
  isAbsolute: (path) => nodePath.isAbsolute(path),
  resolve: (...segments) => nodePath.resolve(...segments),
};
