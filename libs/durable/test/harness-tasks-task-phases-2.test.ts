import { withCancel } from "@msa/chord/context";
import { defineTask, type TaskRuntime } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { addHooks } from "./harness-support.ts";
import { start, oneStep, openRoot } from "./harness-tasks-support.ts";
import { context } from "./session-support.ts";
import { completed, deferred } from "./task-support.ts";

function pingPhases() {
  type PingHooks = { ping(): void };
  const pings: string[] = [];
  const seen: { phase: string; pings: string[]; thinking: string; same?: boolean }[] = [];
  const beforeUse = deferred();
  const afterUse = deferred();
  const waitingBeforeUse = deferred();
  const waitingAfterUse = deferred();
  const ping = (runtime: TaskRuntime<null, { phase: string }, null, PingHooks>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        pings.length = 0;
        yield* awaited(runtime.hooks.each("ping", (handler) => handler()));
        return [...pings];
      }),
    );
  const Phases = defineTask<null, { phase: "a" } | { phase: "b" }, null, PingHooks>({
    name: "test.agent-phases",
    version: 1,
    initial: () => ({ phase: "a" }),
    phases: {
      a: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            waitingBeforeUse.resolve();
            yield* awaited(beforeUse.promise);
            const first = yield* awaited(runtime.agent(ctx));
            seen.push({
              phase: "a",
              pings: yield* awaited(ping(runtime)),
              thinking: first.thinkingLevel,
            });
            waitingAfterUse.resolve();
            yield* awaited(afterUse.promise);
            const second = yield* awaited(runtime.agent(ctx));
            seen.push({
              phase: "a",
              pings: yield* awaited(ping(runtime)),
              thinking: second.thinkingLevel,
              same: second === first,
            });
            yield* awaited(
              runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx),
            );
          }),
        ),
      b: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const agent = yield* awaited(runtime.agent(ctx));
            seen.push({
              phase: "b",
              pings: yield* awaited(ping(runtime)),
              thinking: agent.thinkingLevel,
            });
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  return { pings, seen, beforeUse, afterUse, waitingBeforeUse, waitingAfterUse, Phases };
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
    { phase: "a", pings: ["before"], thinking: "low", same: true },
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
