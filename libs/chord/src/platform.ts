import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Crypto, Effect, FileSystem, Layer, ManagedRuntime, Option, Path } from "effect";
import { Hex } from "effect/encoding";

const layer = Layer.mergeAll(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  NodeFileSystem.layer,
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:path has no stable Effect replacement
  NodePath.layer,
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:crypto has no stable Effect replacement
  NodeCrypto.layer,
);

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

export interface EntryInfo {
  readonly directory: boolean;
  readonly uid: number | undefined;
  readonly mode: number;
}

export const sha256Hex = (text: string): Effect.Effect<string> =>
  onPlatform(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:crypto has no stable Effect replacement
    Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(text))),
  ).pipe(Effect.map(Hex.encode));

export const joinPath = (...segments: readonly string[]): Effect.Effect<string> =>
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:path has no stable Effect replacement
  onPlatform(Path.Path.use((path) => Effect.succeed(path.join(...segments))));

export const removeForce = (path: string): Effect.Effect<void> =>
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  onPlatform(FileSystem.FileSystem.use((fs) => fs.remove(path, { force: true })));

export const makePrivateDirectory = (path: string): Effect.Effect<void> =>
  onPlatform(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
    FileSystem.FileSystem.use((fs) => fs.makeDirectory(path, { mode: 0o700, recursive: true })),
  );

export const isSymbolicLink = (path: string): Effect.Effect<boolean> =>
  onPlatform(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
    FileSystem.FileSystem.use((fs) => Effect.map(Effect.option(fs.readLink(path)), Option.isSome)),
  );

export const entryInfo = (path: string): Effect.Effect<EntryInfo> =>
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  onPlatform(FileSystem.FileSystem.use((fs) => fs.stat(path))).pipe(
    Effect.map((info) => ({
      directory: info.type === "Directory",
      uid: Option.getOrUndefined(info.uid),
      mode: info.mode,
    })),
  );
