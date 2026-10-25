import { Effect, Fiber } from "effect";

import advisorWorkspace from "./advisor-workspace.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import triageFlow from "./triage-flow.ts";
import watchdogModule from "./watchdog.ts";

const { scheduling } = schedule;
const { watchdog } = watchdogModule;

function start(runtime: runtimeTypes.Runtime, now: number): Fiber.Fiber<never, never>[] {
  const { options } = runtime;
  watchdog.open(runtime, now);
  void runtime
    .exclusive(
      Effect.gen(function* () {
        yield* advisorWorkspace.sweep(runtime);
        yield* triageFlow.restartInterrupted(runtime);
        watchdog.reportRecovered(runtime);
      }),
    )
    .catch(() => undefined);
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

function close(runtime: runtimeTypes.Runtime, now: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => watchdog.close(runtime, now));
    yield* advisorWorkspace.sweep(runtime);
  });
}

const background = { close, start, stop };

const backgroundModule = {
  background,
};

export default backgroundModule;
