import { Effect, Fiber } from "effect";

import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import watchdogModule from "./watchdog.ts";

const { scheduling } = schedule;
const { watchdog } = watchdogModule;

function start(runtime: runtimeTypes.Runtime, now: number): Fiber.Fiber<never, never>[] {
  const { options } = runtime;
  watchdog.open(runtime, now);
  void runtime.exclusive(Effect.sync(() => watchdog.reportRecovered(runtime)));
  const fibers: Fiber.Fiber<never, never>[] = [];
  if (options.pollIntervalMs !== null) {
    fibers.push(scheduling.startPolling(runtime, options.pollIntervalMs ?? 5000));
  }
  fibers.push(watchdog.startWatchdog(runtime));
  return fibers;
}

function stop(fibers: readonly Fiber.Fiber<never, never>[]): Effect.Effect<void> {
  return Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
}

const background = { close: watchdog.close, start, stop };

const backgroundModule = {
  background,
};

export default backgroundModule;
