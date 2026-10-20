import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Crypto,
  Effect,
  FileSystem,
  type Layer,
  ManagedRuntime,
  Path,
  type Scope,
  Stream,
} from "effect";
import { Hex } from "effect/encoding";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess } from "effect/process";

import type platformTypes from "./platform.types.ts";
import SpawnError from "./spawn-error.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);

const onNode = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, NodeServices.NodeServices>> =>
  Effect.flatMap(runtime.contextEffect, (context) => Effect.provideContext(effect, context));

const pathOf = (layer: Layer.Layer<Path.Path>): platformTypes.PathOps =>
  ManagedRuntime.make(layer).runSync(Path.Path);

const localPath: platformTypes.PathOps = pathOf(NodePath.layer);
const posixPath: platformTypes.PathOps = pathOf(NodePath.layerPosix);
const win32Path: platformTypes.PathOps = pathOf(NodePath.layerWin32);

const withFs = <A>(
  use: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError>,
): Effect.Effect<A> => onNode(Effect.orDie(FileSystem.FileSystem.use(use)));

const fileExists = (path: string): Effect.Effect<boolean> => withFs((fs) => fs.exists(path));

const readBytes = (path: string): Effect.Effect<Uint8Array> => withFs((fs) => fs.readFile(path));

const readText = (path: string): Effect.Effect<string> => withFs((fs) => fs.readFileString(path));

const writeText = (write: platformTypes.TextWrite): Effect.Effect<void> =>
  withFs((fs) =>
    fs.writeFileString(write.path, write.text, {
      ...(write.mode === undefined ? {} : { mode: write.mode }),
      ...(write.exclusive === true ? { flag: "wx" } : {}),
    }),
  );

const renamePath = ({ from, to }: platformTypes.Rename): Effect.Effect<void> =>
  withFs((fs) => fs.rename(from, to));

const removePath = (path: string): Effect.Effect<void> =>
  withFs((fs) => fs.remove(path, { force: true, recursive: true }));

const makeDirectories = ({ path, mode }: platformTypes.Directories): Effect.Effect<void> =>
  withFs((fs) => fs.makeDirectory(path, { mode, recursive: true }));

const makeTempDirectory = (prefix: string): Effect.Effect<string> =>
  withFs((fs) => fs.makeTempDirectory({ prefix }));

const withCrypto = <A>(
  use: (crypto: Crypto.Crypto) => Effect.Effect<A, PlatformError>,
): Effect.Effect<A> => onNode(Effect.orDie(Crypto.Crypto.use(use)));

const randomHex = (bytes: number): Effect.Effect<string> =>
  withCrypto((crypto) => Effect.map(crypto.randomBytes(bytes), Hex.encode));

const randomUuid: Effect.Effect<string> = withCrypto((crypto) => crypto.randomUUIDv4);

const sha256Hex = (data: Uint8Array): Effect.Effect<string> =>
  withCrypto((crypto) => Effect.map(crypto.digest("SHA-256", data), Hex.encode));

const causeMessage = (error: { readonly cause?: unknown; readonly message: string }): string =>
  error.cause instanceof Error ? error.cause.message : error.message;

const spawnProcess = (
  spec: platformTypes.ProcessSpec,
): Effect.Effect<platformTypes.SpawnedProcess, SpawnError, Scope.Scope> =>
  onNode(
    ChildProcess.make(spec.command, [...spec.args], {
      detached: false,
      stderr: "pipe",
      stdin: spec.stdin,
      stdout: "pipe",
      windowsHide: false,
    }).pipe(
      Effect.map((handle): platformTypes.SpawnedProcess => ({
        exitCode: handle.exitCode.pipe(
          Effect.map(Number),
          Effect.orElseSucceed(() => null),
        ),
        stderr: Stream.ignore(handle.stderr),
        stdout: Stream.ignore(handle.stdout),
      })),
      Effect.mapError((error) => new SpawnError({ cause: error, message: causeMessage(error) })),
    ),
  );

const platform = {
  SpawnError,
  fileExists,
  localPath,
  makeDirectories,
  makeTempDirectory,
  posixPath,
  randomHex,
  randomUuid,
  readBytes,
  readText,
  removePath,
  renamePath,
  sha256Hex,
  spawnProcess,
  win32Path,
  writeText,
};

export default platform;
