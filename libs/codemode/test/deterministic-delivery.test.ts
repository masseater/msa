import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { CodemodeSandbox } from "../src/index.ts";
import {
  BACKENDS,
  type Create,
  remoteDelayingFirst,
  STARTED_AT,
  start,
  waitFor,
} from "./deterministic-support.ts";
import { abortController } from "./support.ts";

const leavesACallWaitingWhenIts = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(sandbox, "return await tools.wait(1)");
    yield* waitFor(() => recorded.calls.length === 1);
    expect(() => recorded.run.deliver(1, STARTED_AT, 1, { ok: true, value: 1n })).toThrow();
    expect(() =>
      recorded.run.deliver(1, STARTED_AT, 1, {
        ok: false,
        message: "x",
        properties: { big: 1n },
      }),
    ).toThrow();
    recorded.run.deliver(1, STARTED_AT, 1, { ok: true, value: "fine" });
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({
      ok: true,
      value: "fine",
    });
  });

const rejectsWithAnErrorCarryingThe = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(
      sandbox,
      "try { await tools.echo(1); } catch (e) { return [e instanceof Error, e.message, e.name, e.structuredOutput]; }",
      {
        answer: () => ({
          ok: false,
          message: "denied",
          properties: { structuredOutput: { code: 7 }, name: "Ignored", message: "ignored" },
        }),
      },
    );
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({
      ok: true,
      value: [true, "denied", "Error", { code: 7 }],
    });
  });

const rejectsRejectionPropertiesThatAreNot = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(sandbox, "return await tools.wait(1)");
    yield* waitFor(() => recorded.calls.length === 1);
    for (const properties of [null, [1]] as unknown as Record<string, unknown>[]) {
      expect(() =>
        recorded.run.deliver(1, STARTED_AT, 1, { ok: false, message: "x", properties }),
      ).toThrow("not an object");
    }
    recorded.run.deliver(1, STARTED_AT, 1, { ok: true, value: 1 });
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({ ok: true, value: 1 });
    expect(() =>
      sandbox.start("", {
        startedAt: STARTED_AT,
        seed: 1,
        tools: [{ name: "a-b" }, { name: "a_b" }],
        onCall: () => {},
      }),
    ).toThrow("script names must be unique");
  });

const usesTheScriptNamesTheRun = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(
      sandbox,
      "return [typeof tools.renamed, Object.keys(tools), ALL_TOOLS.map((tool) => tool.name)]",
      {
        tools: [{ name: "my-tool", jsName: "renamed" }],
      },
    );
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({
      ok: true,
      value: ["function", ["renamed", "my-tool"], ["renamed"]],
    });
  });

const endsWithAnErrorTheScript = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const controller = abortController();
    const recorded = start(
      sandbox,
      `try { await tools.wait(1); } catch { text("caught"); }
				text("after");`,
      { signal: controller.signal },
    );
    yield* waitFor(() => recorded.calls.length === 1);
    controller.abort(new Error("diverged"));
    const result = yield* Effect.promise(() => recorded.run.result);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "aborted", message: "diverged" },
      output: [],
    });
    expect(() => recorded.run.deliver(1, STARTED_AT, 1, { ok: true, value: null })).not.toThrow();
  });

const isFinishedOnceItHasIts = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(sandbox, "await tools.wait(1); return 2");
    yield* waitFor(() => recorded.calls.length === 1);
    expect(recorded.run.finished).toBe(false);
    recorded.run.deliver(1, STARTED_AT, 1, { ok: true, value: null });
    yield* Effect.promise(() => recorded.run.result);
    expect(recorded.run.finished).toBe(true);
  });

const rejectsACallThatIsNot = (create: Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(sandbox, "await Promise.all([tools.wait(1), tools.wait(2)])");
    yield* waitFor(() => recorded.calls.length === 2);
    const { run } = recorded;
    expect(() => run.deliver(1, STARTED_AT, 99, { ok: true, value: null })).toThrow(
      "Call 99 is not waiting",
    );
    run.deliver(1, STARTED_AT, 1, { ok: true, value: null });
    expect(() => run.deliver(1, STARTED_AT, 2, { ok: true, value: null })).toThrow("used once");
    expect(() => run.deliver(0, STARTED_AT, 2, { ok: true, value: null })).toThrow("used once");
    run.deliver(2, STARTED_AT, 2, { ok: true, value: null });
    expect(yield* Effect.promise(() => run.result)).toMatchObject({ ok: true });
  });

const appliesResultsInSeqOrderWhen = Effect.gen(function* () {
  const sandbox = remoteDelayingFirst({});
  const recorded = start(
    sandbox,
    `const order = [];
			await Promise.all([tools.wait("a").then(() => order.push("a")), tools.wait("b").then(() => order.push("b"))]);
			return order;`,
  );
  yield* waitFor(() => recorded.calls.length === 2);
  const [a, b] = recorded.calls;
  recorded.run.deliver(1, STARTED_AT + 1000, a!.id, { ok: true, value: null });
  recorded.run.deliver(2, STARTED_AT + 2000, b!.id, { ok: true, value: null });
  expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({
    ok: true,
    value: ["a", "b"],
  });
});

const readsTheRealClockAndReal = Effect.gen(function* () {
  const sandbox = new CodemodeSandbox();
  const before = yield* Clock.currentTimeMillis;
  const first = yield* Effect.promise(() => sandbox.execute("return [Date.now(), Math.random()]"));
  const second = yield* Effect.promise(() => sandbox.execute("return [Date.now(), Math.random()]"));
  const [now, random] = (first.ok ? first.value : []) as number[];
  expect(now).toBeGreaterThanOrEqual(before);
  expect(now).toBeLessThanOrEqual(yield* Clock.currentTimeMillis);
  expect((second.ok ? second.value : []) as number[]).not.toContain(random);
});

describe("deterministic runs (remote transport)", () => {
  it("applies results in seq order when the transport reorders replies sent in order", () =>
    Effect.runPromise(appliesResultsInSeqOrderWhen));
});

describe("execute() is not deterministic", () => {
  it("reads the real clock and real randomness", () => Effect.runPromise(readsTheRealClockAndReal));
});

for (const [backend, create] of Object.entries(BACKENDS)) {
  describe(`deterministic runs (${backend})`, () => {
    it("leaves a call waiting when its answer cannot be serialized", () =>
      Effect.runPromise(leavesACallWaitingWhenIts(create)));

    it("rejects with an Error carrying the answer's properties", () =>
      Effect.runPromise(rejectsWithAnErrorCarryingThe(create)));

    it("rejects rejection properties that are not an object, and tools sharing a script name", () =>
      Effect.runPromise(rejectsRejectionPropertiesThatAreNot(create)));

    it("uses the script names the run passes", () =>
      Effect.runPromise(usesTheScriptNamesTheRun(create)));

    it("ends with an error the script cannot catch when the caller aborts", () =>
      Effect.runPromise(endsWithAnErrorTheScript(create)));

    it("is finished once it has its outcome", () =>
      Effect.runPromise(isFinishedOnceItHasIts(create)));

    it("rejects a call that is not waiting and a result number used twice", () =>
      Effect.runPromise(rejectsACallThatIsNot(create)));
  });
}
