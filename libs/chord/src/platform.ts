import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Crypto, Effect, FileSystem, Layer, ManagedRuntime, Option, Path } from "effect";
import { Hex } from "effect/encoding";

import type platformTypes from "./platform.types.ts";

const layer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const runtime = ManagedRuntime.make(layer);

const onPlatform = <A>(
  effect: Effect.Effect<A, { readonly cause?: unknown }, Layer.Success<typeof layer>>,
): Effect.Effect<A> =>
  Effect.flatMap(runtime.contextEffect, (context) =>
    Effect.provideContext(
      effect.pipe(Effect.catch((error) => Effect.die(error.cause ?? error))),
      context,
    ),
  );

const sha256Hex = (text: string): Effect.Effect<string> =>
  onPlatform(
    Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(text))),
  ).pipe(Effect.map(Hex.encode));

const joinPath = (...segments: readonly string[]): Effect.Effect<string> =>
  onPlatform(Path.Path.use((path) => Effect.succeed(path.join(...segments))));

const removeForce = (path: string): Effect.Effect<void> =>
  onPlatform(FileSystem.FileSystem.use((fs) => fs.remove(path, { force: true })));

const makePrivateDirectory = (path: string): Effect.Effect<void> =>
  onPlatform(
    FileSystem.FileSystem.use((fs) => fs.makeDirectory(path, { mode: 0o700, recursive: true })),
  );

const isSymbolicLink = (path: string): Effect.Effect<boolean> =>
  onPlatform(
    FileSystem.FileSystem.use((fs) => Effect.map(Effect.option(fs.readLink(path)), Option.isSome)),
  );

const entryInfo = (path: string): Effect.Effect<platformTypes.EntryInfo> =>
  onPlatform(FileSystem.FileSystem.use((fs) => fs.stat(path))).pipe(
    Effect.map((info) => ({
      directory: info.type === "Directory",
      mode: info.mode,
      uid: Option.getOrUndefined(info.uid),
    })),
  );

const platform = {
  entryInfo,
  isSymbolicLink,
  joinPath,
  makePrivateDirectory,
  removeForce,
  sha256Hex,
};

export default platform;
