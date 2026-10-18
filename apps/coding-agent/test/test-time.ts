import { Clock, DateTime, Effect, Random } from "effect";

export const nowMillis = (): number => Effect.runSync(Clock.currentTimeMillis);

export const nowIso = (): string => DateTime.formatIso(Effect.runSync(DateTime.now));

export const randomSuffix = (): string => Effect.runSync(Random.next).toString(36).slice(2);
