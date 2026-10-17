import { Effect, Random } from "effect";

export const nextRandom = (): number => Effect.runSync(Random.next);
