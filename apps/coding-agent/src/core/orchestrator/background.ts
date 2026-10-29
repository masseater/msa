import { Effect } from "effect";

import advisorWorkspace from "./advisor-workspace.ts";
import pullRequestSync from "./pull-request-sync.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import triageFlow from "./triage-flow.ts";
import watchdogModule from "./watchdog.ts";

const { scheduling } = schedule;
const { watchdog } = watchdogModule;

function start(runtime: runtimeTypes.Runtime, now: number): Effect.Effect<never>[] {
  const { options } = runtime;
  watchdog.open(runtime, now);
  runtime.launch(
    Effect.promise(() =>
      runtime
        .exclusive(
          Effect.gen(function* () {
            yield* advisorWorkspace.sweep(runtime);
            yield* triageFlow.restartInterrupted(runtime);
            watchdog.reportRecovered(runtime);
          }),
        )
        .catch(() => undefined),
    ),
  );
  const loops: Effect.Effect<never>[] = [];
  if (options.pollIntervalMs !== null) {
    loops.push(scheduling.pollingLoop(runtime, options.pollIntervalMs ?? 5000));
  }
  loops.push(watchdog.loop(runtime));
  if (options.pullRequestSyncMs !== null) {
    loops.push(pullRequestSync.loop(runtime, options.pullRequestSyncMs));
  }
  return loops;
}

function close(runtime: runtimeTypes.Runtime, now: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => watchdog.close(runtime, now));
    yield* advisorWorkspace.sweep(runtime);
  });
}

const background = { close, start };

const backgroundModule = {
  background,
};

export default backgroundModule;
