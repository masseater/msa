import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, FileSystem, ManagedRuntime, Option, Scope } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import platformModule from "../src/platform.ts";
import type platformTypes from "./platform.types.ts";

const {
  fileExists: fileExistsModule,
  localPath: localPathModule,
  makeTempDirectory: makeTempDirectoryModule,
  readBytes: readBytesModule,
  readText: readTextModule,
  removePath: removePathModule,
  sha256Hex: sha256HexModule,
  writeText: writeTextModule,
} = platformModule;

const runtime = ManagedRuntime.make(NodeServices.layer);

const onNode = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, NodeServices.NodeServices>> =>
  Effect.flatMap(runtime.contextEffect, (context) => Effect.provideContext(effect, context));

const withFs = <A>(
  use: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError>,
): Effect.Effect<A> => FileSystem.FileSystem.use(use).pipe(Effect.orDie, onNode);

const makeDirectory = (path: string): Effect.Effect<void> =>
  withFs((fs) => fs.makeDirectory(path, { recursive: true }));

const writeBytes = ({ path, data }: platformTypes.BytesWrite): Effect.Effect<void> =>
  withFs((fs) => fs.writeFile(path, data));

const readNames = (path: string): Effect.Effect<string[]> => withFs((fs) => fs.readDirectory(path));

const modifiedAt = (path: string): Effect.Effect<number | undefined> =>
  withFs((fs) => fs.stat(path)).pipe(
    Effect.map((info) => Option.getOrUndefined(Option.map(info.mtime, (date) => date.getTime()))),
  );

const realPath = (path: string): Effect.Effect<string> => withFs((fs) => fs.realPath(path));

const command = ([program = "", ...args]: readonly string[]) =>
  ChildProcess.make(program, args, { detached: false, stdin: "ignore" });

const runText = (argv: readonly string[]): Effect.Effect<string> =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(command(argv))).pipe(
    Effect.orDie,
    onNode,
  );

const runStatus = (argv: readonly string[]): Effect.Effect<number> =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.exitCode(command(argv))).pipe(
    Effect.orDie,
    onNode,
    Effect.map(Number),
  );

const startBackground = ([
  program = "",
  ...args
]: readonly string[]): Effect.Effect<platformTypes.Background> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* ChildProcess.make(program, args, {
      detached: false,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    }).pipe(Effect.orDie, onNode, Scope.provide(scope));
    return { stop: Scope.close(scope, Exit.void) };
  });

const platform = {
  fileExists: fileExistsModule,
  localPath: localPathModule,
  makeDirectory,
  makeTempDirectory: makeTempDirectoryModule,
  modifiedAt,
  readBytes: readBytesModule,
  readNames,
  readText: readTextModule,
  realPath,
  removePath: removePathModule,
  runStatus,
  runText,
  sha256Hex: sha256HexModule,
  startBackground,
  writeBytes,
  writeText: writeTextModule,
};

export default platform;
