import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { Effect, ManagedRuntime, Random } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { Hex } from "effect/encoding";

const digestRuntime = ManagedRuntime.make(NodeCrypto.layerDigest);

const randomHex = (byteCount: number): string =>
  Hex.encode(SecureRandom.randomBytesUnsafe(byteCount));

const randomUnit = (): number => Effect.runSync(Random.next);

const randomUuid = (): string => SecureRandom.uuidV4Unsafe();

const sha256Hex = (text: string): string =>
  digestRuntime.runSync(
    Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(text))),
  );

const platformCrypto = {
  randomHex,
  randomUnit,
  randomUuid,
  sha256Hex,
};

export default platformCrypto;
