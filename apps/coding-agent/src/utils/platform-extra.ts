import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodePath from "@effect/platform-node/NodePath";
import { Crypto, Effect, Layer, ManagedRuntime, Path } from "effect";
import { Hex } from "effect/encoding";

const runtime = ManagedRuntime.make(Layer.mergeAll(NodePath.layer, NodeCrypto.layer));

const pathService = runtime.runSync(Path.Path.use((path) => Effect.succeed(path)));
const cryptoService = runtime.runSync(Crypto.Crypto.use((crypto) => Effect.succeed(crypto)));

const posixService = ManagedRuntime.make(Path.layer).runSync(
  Path.Path.use((path) => Effect.succeed(path)),
);

export const posix = {
  basename: (path: string): string => posixService.basename(path),
  join: (...paths: readonly string[]): string => posixService.join(...paths),
  normalize: (path: string): string => posixService.normalize(path),
};

export const delimiter: string = process.platform === "win32" ? ";" : ":";

export const isAbsolute = (path: string): boolean => pathService.isAbsolute(path);

export const extname = (path: string): string => pathService.extname(path);

export const normalize = (path: string): string => pathService.normalize(path);

export const toNamespacedPath = (path: string): string => pathService.toNamespacedPath(path);

const lastWindowsSeparator = (path: string): { trimmed: string; index: number } => {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return { index: Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")), trimmed };
};

export const windowsBasename = (path: string): string => {
  const { trimmed, index } = lastWindowsSeparator(path);
  return trimmed.slice(index + 1);
};

export const windowsDirname = (path: string): string => {
  const { trimmed, index } = lastWindowsSeparator(path);
  if (index < 0) return ".";
  const parent = trimmed.slice(0, index);
  return parent === "" || /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent;
};

export const randomHex = (bytes: number): string =>
  Hex.encode(runtime.runSync(cryptoService.randomBytes(bytes).pipe(Effect.orDie)));
