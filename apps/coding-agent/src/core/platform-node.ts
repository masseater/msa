import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodePath from "@effect/platform-node/NodePath";
import { Crypto, Effect, Layer, ManagedRuntime, Path } from "effect";
import { Hex } from "effect/encoding";
import { dual } from "effect/Function";

const runtime = ManagedRuntime.make(Layer.mergeAll(NodePath.layer, NodeCrypto.layer));

const pathService = runtime.runSync(Path.Path.use((path) => Effect.succeed(path)));
const cryptoService = runtime.runSync(Crypto.Crypto.use((crypto) => Effect.succeed(crypto)));

export interface ParsedPath {
  readonly root: string;
  readonly dir: string;
  readonly base: string;
  readonly ext: string;
  readonly name: string;
}

export const sep: string = pathService.sep;

export const join = (...segments: readonly string[]): string => pathService.join(...segments);

export const resolve = (...segments: readonly string[]): string => pathService.resolve(...segments);

export const dirname = (path: string): string => pathService.dirname(path);

export const basename = (path: string): string => pathService.basename(path);

export const relative: {
  (to: string): (from: string) => string;
  (from: string, to: string): string;
} = dual(2, (from: string, to: string): string => pathService.relative(from, to));

export const parse = (path: string): ParsedPath => pathService.parse(path);

export const randomUuid = (): string => {
  const bytes = runtime.runSync(cryptoService.randomBytes(16).pipe(Effect.orDie));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Hex.encode(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const sha256Hex = (text: string): string =>
  Hex.encode(
    runtime.runSync(
      cryptoService.digest("SHA-256", new TextEncoder().encode(text)).pipe(Effect.orDie),
    ),
  );
