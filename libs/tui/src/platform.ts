import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import Platform from "./platform-class.ts";
import PlatformFailure from "./platform-failure.ts";
import type platformFailureTypes from "./platform-failure.types.ts";
import type platformTypes from "./platform.types.ts";

const failWith =
  (operation: string) =>
  (cause: unknown): platformFailureTypes.PlatformFailure =>
    PlatformFailure.make({ cause, operation });

const platformServices = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const makePlatform = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const nodeDirname = (yield* Path.Path).dirname;
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
    writeFile: ({ path, data, append }) =>
      fs
        .makeDirectory(nodeDirname(path), { recursive: true })
        .pipe(
          Effect.andThen(fs.writeFileString(path, data, append ? { flag: "a" } : {})),
          Effect.mapError(failWith("writeFile")),
        ),
  });
});

const platformLayer = Layer.effect(Platform, makePlatform).pipe(
  Layer.provide(NodeChildProcessSpawner.layer),
  Layer.provide(platformServices),
);

const platformRuntime: ManagedRuntime.ManagedRuntime<Platform, never> =
  ManagedRuntime.make(platformLayer);

const nodePath = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

const pathOperations: platformTypes.PathOperations = {
  basename: (path, suffix) => nodePath.basename(path, suffix),
  dirname: (path) => nodePath.dirname(path),
  isAbsolute: (path) => nodePath.isAbsolute(path),
  join: (...segments) => nodePath.join(...segments),
  resolve: (...segments) => nodePath.resolve(...segments),
  toNamespacedPath: (path) => nodePath.toNamespacedPath(path),
};

const platform = {
  Platform,
  PlatformFailure: PlatformFailure,
  pathOperations,
  platformRuntime,
};

export default platform;
