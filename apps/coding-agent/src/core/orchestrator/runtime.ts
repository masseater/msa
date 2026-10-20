import { DateTime, Effect } from "effect";

const nowMillis: Effect.Effect<number> = Effect.map(DateTime.now, DateTime.toEpochMillis);

const runtime = {
  nowMillis,
};

export default runtime;
