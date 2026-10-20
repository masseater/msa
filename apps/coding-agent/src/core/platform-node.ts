import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodePath from "@effect/platform-node/NodePath";
import { Crypto, Effect, Layer, ManagedRuntime, Path } from "effect";
import { Hex } from "effect/encoding";
import { dual } from "effect/Function";

import type platformNodeTypes from "./platform-node.types.ts";

const runtime = ManagedRuntime.make(Layer.mergeAll(NodePath.layer, NodeCrypto.layer));

const pathService = runtime.runSync(Path.Path.use((path) => Effect.succeed(path)));
const cryptoService = runtime.runSync(Crypto.Crypto.use((crypto) => Effect.succeed(crypto)));

const sep: string = pathService.sep;

const join = (...segments: readonly string[]): string => pathService.join(...segments);

const resolve = (...segments: readonly string[]): string => pathService.resolve(...segments);

const dirname = (path: string): string => pathService.dirname(path);

const basename = (path: string): string => pathService.basename(path);

const relative: {
  (to: string): (from: string) => string;
  (from: string, to: string): string;
} = dual(2, (from: string, to: string): string => pathService.relative(from, to));

const parse = (path: string): platformNodeTypes.ParsedPath => pathService.parse(path);

const randomUuid = (): string => {
  const bytes = runtime.runSync(cryptoService.randomBytes(16).pipe(Effect.orDie));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Hex.encode(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sha256Hex = (text: string): string =>
  Hex.encode(
    runtime.runSync(
      cryptoService.digest("SHA-256", new TextEncoder().encode(text)).pipe(Effect.orDie),
    ),
  );

const platformNode = {
  basename,
  dirname,
  join,
  parse,
  randomUuid,
  relative,
  resolve,
  sep,
  sha256Hex,
};

export default platformNode;
