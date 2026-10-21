import { Crypto, Effect, Random } from "effect";
import { Hex } from "effect/encoding";

import platformRuntime from "./runtime.ts";

const cryptoService = platformRuntime.runSync(Crypto.Crypto);

const randomBytes = (count: number): Uint8Array =>
  platformRuntime.runSync(cryptoService.randomBytes(count).pipe(Effect.orDie));

const randomHex = (byteCount: number): string => Hex.encode(randomBytes(byteCount));

const randomUnit = (): number => Effect.runSync(Random.next);

const randomUuid = (): string => {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Hex.encode(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sha256Hex = (text: string): string =>
  Hex.encode(
    platformRuntime.runSync(
      cryptoService.digest("SHA-256", new TextEncoder().encode(text)).pipe(Effect.orDie),
    ),
  );

const platformCrypto = {
  randomHex,
  randomUnit,
  randomUuid,
  sha256Hex,
};

export default platformCrypto;
