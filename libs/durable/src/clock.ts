import { Clock, Context } from "effect";

const clock = Context.get(Context.empty(), Clock.Clock);

const currentTimeMillis = (): number => clock.currentTimeMillisUnsafe();

const clockModule = {
  currentTimeMillis,
};

export default clockModule;
