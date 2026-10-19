import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Crypto,
  Data,
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

const runtime = ManagedRuntime.make(NodeServices.layer);

const onNode = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, NodeServices.NodeServices>> =>
  Effect.flatMap(runtime.contextEffect, (context) => Effect.provideContext(effect, context));

export interface PathOps {
  readonly sep: string;
  readonly basename: (path: string) => string;
  readonly dirname: (path: string) => string;
  readonly join: (...paths: readonly string[]) => string;
  readonly resolve: (...paths: readonly string[]) => string;
  readonly isAbsolute: (path: string) => boolean;
}

const pathOf = (layer: Layer.Layer<Path.Path>): PathOps =>
  ManagedRuntime.make(layer).runSync(Path.Path);

export const localPath: PathOps = pathOf(NodePath.layer);
export const posixPath: PathOps = pathOf(NodePath.layerPosix);
export const win32Path: PathOps = pathOf(NodePath.layerWin32);

const withFs = <A>(
  use: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError>,
): Effect.Effect<A> => onNode(Effect.orDie(FileSystem.FileSystem.use(use)));

export const fileExists = (path: string): Effect.Effect<boolean> => withFs((fs) => fs.exists(path));

export const readBytes = (path: string): Effect.Effect<Uint8Array> =>
  withFs((fs) => fs.readFile(path));

export const readText = (path: string): Effect.Effect<string> =>
  withFs((fs) => fs.readFileString(path));

export interface TextWrite {
  readonly path: string;
  readonly text: string;
  readonly mode?: number;
  readonly exclusive?: boolean;
}

export const writeText = (write: TextWrite): Effect.Effect<void> =>
  withFs((fs) =>
    fs.writeFileString(write.path, write.text, {
      ...(write.mode === undefined ? {} : { mode: write.mode }),
      ...(write.exclusive === true ? { flag: "wx" } : {}),
    }),
  );

export interface Rename {
  readonly from: string;
  readonly to: string;
}

export const renamePath = ({ from, to }: Rename): Effect.Effect<void> =>
  withFs((fs) => fs.rename(from, to));

export const removePath = (path: string): Effect.Effect<void> =>
  withFs((fs) => fs.remove(path, { recursive: true, force: true }));

export interface Directories {
  readonly path: string;
  readonly mode: number;
}

export const makeDirectories = ({ path, mode }: Directories): Effect.Effect<void> =>
  withFs((fs) => fs.makeDirectory(path, { recursive: true, mode }));

export const makeTempDirectory = (prefix: string): Effect.Effect<string> =>
  withFs((fs) => fs.makeTempDirectory({ prefix }));

const withCrypto = <A>(
  use: (crypto: Crypto.Crypto) => Effect.Effect<A, PlatformError>,
): Effect.Effect<A> => onNode(Effect.orDie(Crypto.Crypto.use(use)));

export const randomHex = (bytes: number): Effect.Effect<string> =>
  withCrypto((crypto) => Effect.map(crypto.randomBytes(bytes), Hex.encode));

export const randomUuid: Effect.Effect<string> = withCrypto((crypto) => crypto.randomUUIDv4);

export const sha256Hex = (data: Uint8Array): Effect.Effect<string> =>
  withCrypto((crypto) => Effect.map(crypto.digest("SHA-256", data), Hex.encode));

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: Stream.Stream<Uint8Array> | "ignore";
}

export interface SpawnedProcess {
  readonly stdout: Stream.Stream<Uint8Array>;
  readonly stderr: Stream.Stream<Uint8Array>;
  readonly exitCode: Effect.Effect<number | null>;
}

const causeMessage = (error: { readonly cause?: unknown; readonly message: string }): string =>
  error.cause instanceof Error ? error.cause.message : error.message;

export const spawnProcess = (
  spec: ProcessSpec,
): Effect.Effect<SpawnedProcess, SpawnError, Scope.Scope> =>
  onNode(
    ChildProcess.make(spec.command, [...spec.args], {
      stdin: spec.stdin,
      stdout: "pipe",
      stderr: "pipe",
      detached: false,
      windowsHide: false,
    }).pipe(
      Effect.map((handle): SpawnedProcess => ({
        stdout: Stream.ignore(handle.stdout),
        stderr: Stream.ignore(handle.stderr),
        exitCode: handle.exitCode.pipe(
          Effect.map(Number),
          Effect.orElseSucceed(() => null),
        ),
      })),
      Effect.mapError((error) => new SpawnError({ message: causeMessage(error), cause: error })),
    ),
  );
