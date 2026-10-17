import { Clock, Effect } from "effect";

export const currentTimeMillis = (): number => Effect.runSync(Clock.currentTimeMillis);
