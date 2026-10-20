import { type Id, type TaskId, defineTask } from "@msa/durable";
import { Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { safeNow as safeNowModule } from "../src/harness/harness.ts";
import { contained as containedModule } from "../src/session/session.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { ControlledStorage, context } = sessionSupport;
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
  override task(...args: Parameters<MemoryStorage["task"]>) {
    this.#fail("task");
    return Promise.resolve(super.task(...args));
  }
  override scanEntries(...args: Parameters<MemoryStorage["scanEntries"]>) {
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
  override mintId<I extends Id<string>>(): Promise<I> {
    this.#fail("mintId");
    return Promise.resolve(super.mintId<I>());
  }
}

const started = Effect.fn("started")(function* (storage: MemoryStorage) {
  signals.length = 0;
  const opened = yield* openTasks(storage, [Waiting]);
  const root = yield* awaited(opened.harness.root(context));
  return { ...opened, root };
});

const running = Effect.fn("running")(function* (harness: Harness, id: TaskId) {
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
