import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import deterministicSupport from "./deterministic-support.ts";
import type deterministicSupportTypes from "./deterministic-support.types.ts";
import support from "./support.ts";

const { BACKENDS, BUDGET, PINNED_FIRST_RANDOM, PINNED_SEED_ZERO, STARTED_AT, start, waitFor } =
  deterministicSupport;
const { fromJson } = support;

afterEach(() => {
  vi.unstubAllEnvs();
});

const makesTheSameCallsAndOutput = (create: deterministicSupportTypes.Create) =>
  Effect.gen(function* () {
    const code = `
				const values = [Date.now(), performance.now(), Math.random(), Math.random(), new Date().toISOString()];
				const first = await tools.echo(values);
				text(JSON.stringify([Date.now(), performance.now(), Math.random()]));
				return await tools.echo(first.concat(Math.random()));
			`;
    const sandbox = create();
    const one = start(sandbox, code);
    const two = start(sandbox, code);
    const [a, b] = yield* Effect.promise(() => Promise.all([one.run.result, two.run.result]));
    const timeless = (result: typeof a) => ({
      ...result,
      calls: result.calls.map(({ name, status }) => ({ name, status })),
    });
    expect(timeless(a)).toEqual(timeless(b));
    expect(one.calls).toEqual(two.calls);
    const [now, elapsed, random] = one.calls[0]!.args as number[];
    expect([now, elapsed]).toEqual([STARTED_AT, 0]);
    expect((one.calls[0]!.args as unknown[])[4]).toBe("2026-01-15T10:00:00.000Z");
    const printed = (yield* fromJson(
      a.ok ? (a.output[0] as { text: string }).text : "[]",
    )) as number[];
    expect(printed.slice(0, 2)).toEqual([STARTED_AT + 1000, 1000]);
    expect(random).toBe(PINNED_FIRST_RANDOM);

    const later = start(sandbox, code, { startedAt: STARTED_AT + 5000 });
    const reseeded = start(sandbox, code, { seed: 2 });
    yield* Effect.promise(() => Promise.all([later.run.result, reseeded.run.result]));
    expect((later.calls[0]!.args as number[])[2]).toBe(random);
    expect((reseeded.calls[0]!.args as number[])[2]).not.toBe(random);
    const zero = start(sandbox, "return [Math.random(), Math.random()]", { seed: 0 });
    const zeroResult = yield* Effect.promise(() => zero.run.result);
    expect(zeroResult).toMatchObject({ ok: true, value: PINNED_SEED_ZERO });
    expect((zeroResult.ok ? zeroResult.value : []) as number[]).not.toContain(random);
  });

const runsInUtcWhateverTheHost = (create: deterministicSupportTypes.Create) =>
  Effect.gen(function* () {
    vi.stubEnv("TZ", "Asia/Kolkata");
    const code =
      "return [new Date(0).getHours(), new Date(0).getTimezoneOffset(), typeof WeakRef, typeof FinalizationRegistry]";
    const sandbox = create();
    const { run } = start(sandbox, code);
    expect(yield* Effect.promise(() => run.result)).toMatchObject({
      ok: true,
      value: [0, 0, "undefined", "undefined"],
    });
    expect(yield* Effect.promise(() => sandbox.execute(code))).toMatchObject({
      ok: true,
      value: [5, -330, "function", "function"],
    });
  });

const appliesResultsInSeqOrderWhatever = (create: deterministicSupportTypes.Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(
      sandbox,
      `const order = [];
				await Promise.all([tools.wait("a").then(() => order.push("a")), tools.wait("b").then(() => order.push("b"))]);
				return order;`,
    );
    yield* waitFor(() => recorded.calls.length === 2 && recorded.idles.length === 1);
    const [a, b] = recorded.calls;
    recorded.run.deliver(2, STARTED_AT + 2000, a!.id, { ok: true, value: null });
    recorded.run.deliver(1, STARTED_AT + 1000, b!.id, { ok: true, value: null });
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({
      ok: true,
      value: ["b", "a"],
    });
    expect(recorded.idles).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

const reportsTheFingerprintBeforeAnyCall = (
  create: deterministicSupportTypes.Create,
  backend: string,
) =>
  Effect.gen(function* () {
    const sandbox = create({ memoryLimitBytes: 64 * 1024 * 1024 });
    const recorded = start(
      sandbox,
      "await tools.echo(1); await Promise.all([tools.echo(2), tools.echo(3)]);",
    );
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({ ok: true });
    expect(recorded.events.slice(0, 3)).toEqual(["started", "call 1", "idle 0"]);
    expect(recorded.idles).toEqual([
      [0, 1],
      [1, 3],
      [2, 3],
    ]);
    expect(recorded.calls.map((call) => [call.id, call.target, call.name, call.args])).toEqual([
      [1, "tool", "echo", 1],
      [2, "tool", "echo", 2],
      [3, "tool", "echo", 3],
    ]);
    const fingerprint = recorded.fingerprint()!;
    expect(fingerprint).toMatch(
      /^quickjs-wasi \S+, quickjs \S+, prelude [0-9a-f]{8}, deterministic \d+, stack \d+, heap 67108864, budget \S+$/u,
    );
    if (backend === "remote") expect(fingerprint).toContain(`budget ${BUDGET}`);
    else expect(fingerprint).toContain("budget none");

    const same = start(sandbox, "return 1");
    const other = start(create({ memoryLimitBytes: 32 * 1024 * 1024 }), "return 1");
    yield* Effect.promise(() => Promise.all([same.run.result, other.run.result]));
    expect(same.fingerprint()).toBe(fingerprint);
    expect(other.fingerprint()).not.toBe(fingerprint);
  });

const numbersCallsToGlobalsWithTools = (create: deterministicSupportTypes.Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(
      sandbox,
      `const found = await search("x", 2);
				try { await tools.echo("fail"); } catch (error) { text(error.message); }
				return found;`,
      {
        answer: (call) =>
          call.args === "fail"
            ? { message: "no", ok: false }
            : { ok: true, value: call.name === "search" ? ["found"] : call.args },
        globals: [{ name: "search", spread: true }],
      },
    );
    const result = yield* Effect.promise(() => recorded.run.result);
    expect(recorded.calls[0]).toEqual({
      args: ["x", 2],
      id: 1,
      name: "search",
      target: "global",
    });
    expect(result).toMatchObject({
      ok: true,
      output: [{ text: "no", type: "text" }],
      value: ["found"],
    });
    expect(recorded.calls[1]).toMatchObject({ id: 2, name: "echo", target: "tool" });
    expect(recorded.idles.slice(0, 2)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(result.calls).toMatchObject([{ name: "echo", status: "error" }]);
  });

const keepsTheClockMonotonicAndRejects = (create: deterministicSupportTypes.Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const recorded = start(
      sandbox,
      "const before = Date.now(); await tools.wait(1); return [before, Date.now(), performance.now()]",
    );
    yield* waitFor(() => recorded.calls.length === 1);
    expect(() => recorded.run.deliver(1, Number.NaN, 1, { ok: true, value: null })).toThrow(
      "not a finite number",
    );
    recorded.run.deliver(1, STARTED_AT - 2000, 1, { ok: true, value: null });
    expect(yield* Effect.promise(() => recorded.run.result)).toMatchObject({
      ok: true,
      value: [STARTED_AT, STARTED_AT, 0],
    });
  });

const reportsTheResultTheVmWas = (create: deterministicSupportTypes.Create) =>
  Effect.gen(function* () {
    const sandbox = create();
    const returned = start(sandbox, "await tools.echo(1); return await tools.echo(2)");
    const thrown = start(
      sandbox,
      "await tools.echo(1); await Promise.all([tools.echo(2), tools.echo(3)]); throw new Error('x')",
    );
    const first = start(sandbox, "return 1");
    expect(yield* Effect.promise(() => returned.run.result)).toMatchObject({
      during: { issued: 2, seq: 2 },
      ok: true,
      value: 2,
    });
    expect(yield* Effect.promise(() => thrown.run.result)).toMatchObject({
      during: { issued: 3, seq: 3 },
      ok: false,
    });
    expect(yield* Effect.promise(() => first.run.result)).toMatchObject({
      during: { issued: 0, seq: 0 },
      ok: true,
    });
    expect(yield* Effect.promise(() => sandbox.execute("return 1"))).not.toHaveProperty("during");
  });

for (const [backend, create] of Object.entries(BACKENDS)) {
  describe(`deterministic runs (${backend})`, () => {
    it("makes the same calls and output for the same start, seed, and results", () =>
      Effect.runPromise(makesTheSameCallsAndOutput(create)));

    it("runs in UTC whatever the host's timezone, and without WeakRef or FinalizationRegistry", () =>
      Effect.runPromise(runsInUtcWhateverTheHost(create)));

    it("applies results in seq order, whatever order they are delivered in", () =>
      Effect.runPromise(appliesResultsInSeqOrderWhatever(create)));

    it("reports the fingerprint before any call and the calls issued after each result", () =>
      Effect.runPromise(reportsTheFingerprintBeforeAnyCall(create, backend)));

    it("numbers calls to globals with tools, and answers errors as rejections", () =>
      Effect.runPromise(numbersCallsToGlobalsWithTools(create)));

    it("keeps the clock monotonic and rejects a clock value that is not finite", () =>
      Effect.runPromise(keepsTheClockMonotonicAndRejects(create)));

    it("reports the result the VM was processing when the script ended", () =>
      Effect.runPromise(reportsTheResultTheVmWas(create)));
  });
}
