import { Effect, Random } from "effect";

const nextRandom = (): number => Effect.runSync(Random.next);

const random = {
  nextRandom,
};

export default random;
