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

const posix = {
  basename: (path: string): string => posixService.basename(path),
  join: (...paths: readonly string[]): string => posixService.join(...paths),
  normalize: (path: string): string => posixService.normalize(path),
};

const delimiter: string = process.platform === "win32" ? ";" : ":";

const isAbsolute = (path: string): boolean => pathService.isAbsolute(path);

const extname = (path: string): string => pathService.extname(path);

const normalize = (path: string): string => pathService.normalize(path);

const toNamespacedPath = (path: string): string => pathService.toNamespacedPath(path);

const lastWindowsSeparator = (path: string): { trimmed: string; index: number } => {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return { index: Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")), trimmed };
};

const windowsBasename = (path: string): string => {
  const { trimmed, index } = lastWindowsSeparator(path);
  return trimmed.slice(index + 1);
};

const windowsDirname = (path: string): string => {
  const { trimmed, index } = lastWindowsSeparator(path);
  if (index < 0) return ".";
  const parent = trimmed.slice(0, index);
  return parent === "" || /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent;
};

const randomHex = (bytes: number): string =>
  Hex.encode(runtime.runSync(cryptoService.randomBytes(bytes).pipe(Effect.orDie)));

const platformExtra = {
  delimiter,
  extname,
  isAbsolute,
  normalize,
  posix,
  randomHex,
  toNamespacedPath,
  windowsBasename,
  windowsDirname,
};

export default platformExtra;
