import { Effect } from "effect";

import promptsModule from "./prompts.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type threadRunTypes from "./thread-run.types.ts";

const { store } = storeModule;
const { prompts } = promptsModule;
const { nowMillis } = runtimeModule;

const RUN_POLL_MS = 100;

type ThreadRun = threadRunTypes.ThreadRun;

function current(thread: ThreadRun): boolean {
  return thread.runtime.runs.get(thread.threadId) === thread.run;
}

function markActive(thread: ThreadRun): Effect.Effect<void> {
  return Effect.map(nowMillis, (at) => {
    thread.runtime.activity.set(thread.threadId, { at, messages: thread.worker.messages.length });
  });
}

function whileCurrent<A>(
  thread: ThreadRun,
  effect: Effect.Effect<A>,
): Effect.Effect<A | undefined> {
  const ended = Effect.gen(function* () {
    while (current(thread)) {
      yield* markActive(thread);
      yield* Effect.sleep(thread.runtime.options.runPollMs ?? RUN_POLL_MS);
    }
    return undefined;
  });
  return Effect.race(effect, ended);
}

function readIds(thread: ThreadRun): Set<string> {
  return new Set(
    store.notesReadBy(thread.runtime.database, thread.threadId).map((note) => note.id),
  );
}

function arrivedSince(thread: ThreadRun, readBefore: ReadonlySet<string>) {
  return store
    .notesReadBy(thread.runtime.database, thread.threadId)
    .filter((note) => !readBefore.has(note.id));
}

function settle(thread: ThreadRun, error: unknown, verdict?: runtimeTypes.ReviewVerdict): void {
  void thread.runtime.settle(thread.threadId, thread.run, thread.worker, error, verdict);
}

function askForDecision(thread: ThreadRun, request: runtimeTypes.DecisionAsk): void {
  void thread.runtime.settle(
    thread.threadId,
    thread.run,
    thread.worker,
    undefined,
    undefined,
    request,
  );
}

function continueWith(thread: ThreadRun, prompt: string): void {
  const { runtime, threadId, run, worker } = thread;
  void worker.run.prompting.prompt(prompt).then(
    () => runtime.afterTurn(threadId, run, worker),
    (error: unknown) => settle(thread, error),
  );
}

function continueWithNotes(thread: ThreadRun, readBefore: ReadonlySet<string>): boolean {
  const arrived = arrivedSince(thread, readBefore);
  if (arrived.length === 0) return false;
  continueWith(thread, prompts.notesBlock(arrived));
  return true;
}

const threadRuns = {
  askForDecision,
  continueWith,
  continueWithNotes,
  current,
  readIds,
  settle,
  whileCurrent,
};

const threadRun = { threadRuns };

export default threadRun;
