import { Effect, Function, ManagedRuntime } from "effect";
import { Digest, SecureRandom } from "effect/crypto";

import type cryptoTypes from "./crypto.types.ts";

const ALGORITHMS: Readonly<Record<cryptoTypes.DigestAlgorithm, Digest.Algorithm>> = Object.freeze({
  "SHA-1": Digest.sha1,
  "SHA-256": Digest.sha256,
  "SHA-384": Digest.sha384,
  "SHA-512": Digest.sha512,
});

const webDigest = ManagedRuntime.make(Digest.layerWebCrypto).runSync(Digest.Digest);

const randomBytes = (size: number): Uint8Array => SecureRandom.randomBytesUnsafe(size);

const randomHex = (size: number): string =>
  Array.from(randomBytes(size), (byte) => byte.toString(16).padStart(2, "0")).join("");

const digest: {
  (data: Uint8Array): (algorithm: cryptoTypes.DigestAlgorithm) => Effect.Effect<Uint8Array>;
  (algorithm: cryptoTypes.DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array>;
} = Function.dual(
  2,
  (algorithm: cryptoTypes.DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array> =>
    webDigest.digest(ALGORITHMS[algorithm], data),
);

const randomUuid = (): string => SecureRandom.uuidV4Unsafe();

const cryptoModule = {
  digest,
  randomBytes,
  randomHex,
  randomUuid,
};

export default cryptoModule;
