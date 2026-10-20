import { Crypto, Effect, Function } from "effect";

import type cryptoTypes from "./crypto.types.ts";

const webCrypto = Crypto.make({
  digest: (algorithm, data) =>
    Effect.map(
      Effect.promise(() => globalThis.crypto.subtle.digest(algorithm, data)),
      (digested) => new Uint8Array(digested),
    ),
  randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
});

const randomBytes = (size: number): Uint8Array =>
  Effect.runSync(Effect.orDie(webCrypto.randomBytes(size)));

const randomHex = (size: number): string =>
  Array.from(randomBytes(size), (byte) => byte.toString(16).padStart(2, "0")).join("");

const digest: {
  (data: Uint8Array): (algorithm: cryptoTypes.DigestAlgorithm) => Effect.Effect<Uint8Array>;
  (algorithm: cryptoTypes.DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array>;
} = Function.dual(
  2,
  (algorithm: cryptoTypes.DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array> =>
    Effect.orDie(webCrypto.digest(algorithm, data)),
);

const randomUuid = (): string => Effect.runSync(Effect.orDie(webCrypto.randomUUIDv4));

const cryptoModule = {
  digest,
  randomBytes,
  randomHex,
  randomUuid,
};

export default cryptoModule;
