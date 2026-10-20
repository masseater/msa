import type { Context } from "@msa/chord";
import { withCancel } from "@msa/chord/context";
import { type TaskRuntime, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { addHooks } = harnessSupport;
const { oneStep, openRoot, start } = harnessTasksSupport;
const { context } = sessionSupport;
const { completed, deferred } = taskSupport;

type PingHooks = { ping(): void };
type PingRuntime = TaskRuntime<null, { phase: string }, null, PingHooks>;
type Seen = { phase: string; pings: string[]; thinking: string; same?: boolean };

const observer = (pings: string[], seen: Seen[]) =>
  Effect.fn("observe")(function* (runtime: PingRuntime, ctx: Context, phase: string) {
    const agent = yield* awaited(runtime.agent(ctx));
    pings.length = 0;
    yield* awaited(runtime.hooks.each("ping", (handler) => handler()));
    const entry: Seen = { phase, pings: [...pings], thinking: agent.thinkingLevel };
    seen.push(entry);
    return { agent, entry };
  });

function pingPhases() {
  const pings: string[] = [];
  const seen: Seen[] = [];
  const beforeUse = deferred();
  const afterUse = deferred();
  const waitingBeforeUse = deferred();
  const waitingAfterUse = deferred();
  const observe = observer(pings, seen);
  const Phases = defineTask<null, { phase: "a" } | { phase: "b" }, null, PingHooks>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "a" }),
    name: "test.agent-phases",
    phases: {
      a: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            waitingBeforeUse.resolve();
            yield* awaited(beforeUse.promise);
            const first = yield* observe(runtime, ctx, "a");
            waitingAfterUse.resolve();
            yield* awaited(afterUse.promise);
            const second = yield* observe(runtime, ctx, "a");
            second.entry.same = second.agent === first.agent;
            yield* awaited(
              runtime.commit(() => ({ checkpoint: { phase: "b" }, status: "running" }), ctx),
            );
          }),
        ),
      b: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* observe(runtime, ctx, "b");
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    version: 1,
  });
  return { Phases, afterUse, beforeUse, pings, seen, waitingAfterUse, waitingBeforeUse };
}

const resolvesAgentFirst = Effect.gen(function* () {
  const { pings, seen, beforeUse, afterUse, waitingBeforeUse, waitingAfterUse, Phases } =
    pingPhases();
  const { harness, registry, root } = yield* openRoot([Phases]);
  addHooks(registry, Phases, { ping: () => void pings.push("before") });
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Phases, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();

  yield* awaited(waitingBeforeUse.promise);
  yield* awaited(root.configure({ thinkingLevel: "low" }, context));
  beforeUse.resolve();
  yield* awaited(waitingAfterUse.promise);
  addHooks(registry, Phases, { ping: () => void pings.push("late") });
  yield* awaited(root.configure({ thinkingLevel: "high" }, context));
  afterUse.resolve();

  yield* awaited(harness.waitForTask(id, context));
  expect(seen).toEqual([
    { phase: "a", pings: ["before"], thinking: "low" },
    { phase: "a", pings: ["before"], same: true, thinking: "low" },
    { phase: "b", pings: ["before", "late"], thinking: "high" },
  ]);
  yield* awaited(harness.close(context));
});

const rejectsAgentWait = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let cancelled: unknown;
  let resolved: string | undefined;
  const Agent = oneStep("test.agent-cancel", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        const caller = withCancel(ctx);
        caller.cancel(new Error("caller gone"));
        cancelled = yield* awaited(runtime.agent(caller.context).catch((error: unknown) => error));
        resolved = (yield* awaited(runtime.agent(ctx))).thinkingLevel;
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Agent]);
  yield* awaited(harness.waitForTask(yield* awaited(start(root, Agent)), context));
  expect(cancelled).toMatchObject({ message: "caller gone" });
  expect(resolved).toBe("off");
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("resolves the agent at first use in a phase from its snapshot, keeps it for the phase, and anew at the next", () =>
    Effect.runPromise(resolvesAgentFirst));

  it("rejects an agent() wait whose caller context is cancelled, without affecting the phase's resolution", () =>
    Effect.runPromise(rejectsAgentWait));
});

const observesFailedAgent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let fail = false;
  const settings = {
    get extensions(): undefined {
      if (fail) throw new Error("settings broke");
      return undefined;
    },
  };
  let resolved: unknown;
  const Agent = oneStep("test.agent-failure", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        const caller = withCancel(ctx);
        caller.cancel(new Error("caller gone"));
        fail = true;
        yield* awaited(runtime.agent(caller.context).catch(() => {}));
        yield* Effect.sleep(1);
        resolved = yield* awaited(runtime.agent(ctx).catch((error: unknown) => error));
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Agent], { settings });
  yield* awaited(harness.waitForTask(yield* awaited(start(root, Agent)), context));
  expect(resolved).toMatchObject({ message: "settings broke" });
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("observes a failed agent resolution whose only caller stopped waiting", () =>
    Effect.runPromise(observesFailedAgent));
});
