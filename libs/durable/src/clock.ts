import { Clock, Context } from "effect";

const clock = Context.get(Context.empty(), Clock.Clock);

export const currentTimeMillis = (): number => clock.currentTimeMillisUnsafe();
