import { Crypto, Effect, Function } from "effect";

export type DigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

const webCrypto =
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- effect の Crypto は 4.0.2 で pre-GA
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.map(
        Effect.promise(() => globalThis.crypto.subtle.digest(algorithm, data)),
        (digested) => new Uint8Array(digested),
      ),
  });

export const randomBytes = (size: number): Uint8Array =>
  Effect.runSync(Effect.orDie(webCrypto.randomBytes(size)));

export const digest: {
  (data: Uint8Array): (algorithm: DigestAlgorithm) => Effect.Effect<Uint8Array>;
  (algorithm: DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array>;
} = Function.dual(
  2,
  (algorithm: DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array> =>
    Effect.orDie(webCrypto.digest(algorithm, data)),
);

export const randomUuid = (): string => Effect.runSync(Effect.orDie(webCrypto.randomUUIDv4));

