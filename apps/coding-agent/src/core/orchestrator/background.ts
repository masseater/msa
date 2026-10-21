import { Effect, Fiber } from "effect";

import processAliveModule from "../platform/node/process-alive.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import watchdogModule from "./watchdog.ts";

const { store } = storeModule;
const { scheduling } = schedule;
const { watchdog } = watchdogModule;
const { currentPid } = processAliveModule;

function start(runtime: runtimeTypes.Runtime): Fiber.Fiber<never, never>[] {
  const { options } = runtime;
  store.claimProject(runtime.database, options.project, currentPid());
  const fibers: Fiber.Fiber<never, never>[] = [];
  if (options.pollIntervalMs !== null) {
    fibers.push(scheduling.startPolling(runtime, options.pollIntervalMs ?? 5000));
  }
  if (options.watchdog !== null) {
    fibers.push(watchdog.startWatchdog(runtime, options.watchdog ?? watchdog.DEFAULTS));
  }
  return fibers;
}

function stop(fibers: readonly Fiber.Fiber<never, never>[]): Effect.Effect<void> {
  return Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
}

const background = { start, stop };

const backgroundModule = {
  background,
};

export default backgroundModule;
