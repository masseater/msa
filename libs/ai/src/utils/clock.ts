import { Clock, Effect } from "effect";

const currentTimeMillis = (): number => Effect.runSync(Clock.currentTimeMillis);

const clock = {
  currentTimeMillis,
};

export default clock;
