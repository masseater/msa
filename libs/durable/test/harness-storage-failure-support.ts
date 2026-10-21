import durable from "@msa/durable";
import type harnessTypes from "@msa/durable/harness.types";
import type durableTypes from "@msa/durable/index.types";
import type memoryTypes from "@msa/durable/storage/memory.types";
import { Effect } from "effect";

import harnessModule from "../src/harness/harness.ts";
import session from "../src/session/session-state.ts";
import ControlledStorage from "./controlled-storage.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineTask } = durable;
const { contained: containedModule } = session;
const { safeNow: safeNowModule } = harnessModule;

const { awaited } = effectSupport;
const { context } = sessionSupport;
const { aborted, deferred, openTasks } = taskSupport;

const signals: string[] = [];

const Waiting = defineTask<null, { phase: "work" }, null>({
  abort: (_task, runtime, abortContext) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            runtime.commit(
              () => ({ outcome: { status: "aborted" }, status: "terminal" }),
              abortContext,
            ),
          ),
        ),
      ),
    ),
  initial: () => ({ phase: "work" }),
  name: "test.waiting",
  phases: {
    work: (_task, runtime) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(aborted(runtime.signal).catch(() => {}));
          signals.push("aborted");
        }),
      ),
  },
  version: 1,
});

class FailingCalls extends ControlledStorage {
  readonly error = new Error("disk gone");
  readonly failing = new Set<string>();
  heldRange:
    | { readonly entered: ReturnType<typeof deferred<void>>; readonly release: Promise<unknown> }
    | undefined;
  #fail(method: string): void {
    if (this.failing.delete(method)) throw this.error;
  }
  override task(...args: Parameters<memoryTypes.MemoryStorage["task"]>) {
    this.#fail("task");
    return Promise.resolve(super.task(...args));
  }
  override scanEntries(...args: Parameters<memoryTypes.MemoryStorage["scanEntries"]>) {
    const superScanEntries = super.scanEntries.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (args[1] > 1) {
          const held = this.heldRange;
          if (held !== undefined) {
            held.entered.resolve();
            yield* awaited(held.release);
          }
          this.#fail("scanRange");
        }
        return yield* awaited(superScanEntries(...args));
      }),
    );
  }
  override mintId<I extends durableTypes.Id<string>>(): Promise<I> {
    this.#fail("mintId");
    return Promise.resolve(super.mintId<I>());
  }
}

const started = Effect.fn("started")(function* (storage: memoryTypes.MemoryStorage) {
  signals.length = 0;
  const opened = yield* openTasks(storage, [Waiting]);
  const root = yield* awaited(opened.harness.root(context));
  return { ...opened, root };
});

const running = Effect.fn("running")(function* (
  harness: harnessTypes.Harness,
  id: durableTypes.TaskId,
) {
  while ((yield* awaited(harness.getTask(id, context)))?.state.status !== "running")
    yield* Effect.sleep(1);
});

const harnessStorageFailureSupport = {
  FailingCalls,
  Waiting,
  contained: containedModule,
  running,
  safeNow: safeNowModule,
  signals,
  started,
};

export default harnessStorageFailureSupport;
