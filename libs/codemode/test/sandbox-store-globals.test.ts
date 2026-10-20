import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import sandboxSupport from "./sandbox-support.ts";

const { closeSandboxes, createSandbox, describeBackends, echo, newSandbox } = sandboxSupport;

const readsTheSnapshotAndReportsWrites = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(
      `
				const seen = load("counter");
				store("counter", seen + 1);
				store("list", [1, { a: null }]);
				store("old", undefined);
				return [seen, load("counter"), load("missing"), load("old")];
			`,
      { store: { counter: 41, old: "x" } },
    ),
  );
  expect(result).toMatchObject({
    ok: true,
    storeWrites: { delete: ["old"], set: { counter: 42, list: [1, { a: null }] } },
    value: [41, 42, null, null],
  });
});

const returnsCopiesSoMutatingALoaded = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(
      `const value = load("obj"); value.a = 2; const kept = { b: 1 }; store("kept", kept); kept.b = 2;
				return [load("obj").a, load("kept").b];`,
      { store: { obj: { a: 1 } } },
    ),
  );
  expect(result).toMatchObject({
    ok: true,
    storeWrites: { set: { kept: { b: 1 } } },
    value: [1, 1],
  });
});

const rejectsInvalidKeysValuesAndOversized = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				const attempt = (fn) => { try { fn(); return "ok"; } catch (error) { return error.name; } };
				return [
					attempt(() => store(1, "x")),
					attempt(() => load({})),
					attempt(() => store("fn", () => 1)),
					attempt(() => store("big", "x".repeat(300 * 1024))),
					attempt(() => { for (let i = 0; i < 8; i++) store("k" + i, "x".repeat(200 * 1024)); }),
				];
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: ["TypeError", "TypeError", "TypeError", "RangeError", "RangeError"],
  });
});

const explainsOversizedWrites = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`store("img", "x".repeat(300 * 1024));`),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.message).toContain('store("img") value has 307202 characters of JSON');
  expect(result.error.message).toContain("Show images with image()");
});

function reservesTheStoreAndLoadNames(): void {
  const execute = () => undefined;
  expect(() => newSandbox({ globals: [{ execute, name: "store" }] })).toThrow(/Invalid global/u);
  expect(() => newSandbox({ globals: [{ execute, name: "load" }] })).toThrow(/Invalid global/u);
}

const exposesGlobalsAsTopLevelFunctions = Effect.gen(function* () {
  const seen: unknown[] = [];
  const sandbox = newSandbox({
    globals: [{ execute: (args) => void seen.push(args), name: "attach" }],
    tools: [echo],
  });
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				await attach({ ref: 1 });
				attach("not awaited");
				return [typeof attach, typeof globalThis.attach, await tools.echo(2)];
			`),
  );
  expect(result).toMatchObject({ ok: true, value: ["function", "function", 2] });
  expect(result.calls.map((call) => call.name)).toEqual(["echo"]);
  expect(seen).toEqual([{ ref: 1 }, "not awaited"]);
});

const groupsNamespacedGlobalsAndSpreadsArguments = Effect.gen(function* () {
  const seen: unknown[] = [];
  const sandbox = newSandbox({
    globals: [
      { execute: (args) => void seen.push(args), name: "models.list", spread: true },
      { execute: (args) => args, name: "models.first" },
    ],
  });
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				await models.list("classifier", undefined, 3);
				await models.list();
				try { models.extra = 1; } catch {}
				return [Object.keys(models), await models.first("a", "ignored"), "extra" in models];
			`),
  );
  expect(result).toMatchObject({ ok: true, value: [["list", "first"], "a", false] });
  expect(seen).toEqual([["classifier", null, 3], []]);
});

const namesTheMembersOfANamespace = Effect.gen(function* () {
  const execute = () => undefined;
  const sandbox = newSandbox({
    globals: [
      { execute, name: "models.classify" },
      { execute, name: "models.generateImages" },
    ],
  });
  const result = yield* Effect.promise(() => sandbox.execute("await models.generateImage();"));
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.message).toBe(
    'models.generateImage does not exist. Did you mean models.generateImages? Check for a member with "generateImage" in models.',
  );
});

function rejectsInvalidAndReservedGlobalNames(): void {
  const execute = () => undefined;
  for (const name of ["a.b.c", "a.", ".a", "tools.x", "store.x", "a.not-valid"]) {
    expect(() => newSandbox({ globals: [{ execute, name }] }), name).toThrow(/Invalid global/u);
  }
  expect(() =>
    newSandbox({
      globals: [
        { execute, name: "models" },
        { execute, name: "models.list" },
      ],
    }),
  ).toThrow(/conflicts with the namespace/u);
  expect(() => newSandbox({ globals: [{ execute, name: "not-valid" }] })).toThrow(
    /Invalid global/u,
  );
  expect(() => newSandbox({ globals: [{ execute, name: "tools" }] })).toThrow(/Invalid global/u);
  expect(() => newSandbox({ globals: [{ execute, name: "console" }] })).toThrow(/Invalid global/u);
}

afterEach(closeSandboxes);

describeBackends("store and load", () => {
  it("reads the snapshot and reports writes", () =>
    Effect.runPromise(readsTheSnapshotAndReportsWrites));

  it("returns copies, so mutating a loaded value does not change the store", () =>
    Effect.runPromise(returnsCopiesSoMutatingALoaded));

  it("rejects invalid keys, values, and oversized writes inside the script", () =>
    Effect.runPromise(rejectsInvalidKeysValuesAndOversized));

  it("explains oversized writes", () => Effect.runPromise(explainsOversizedWrites));

  it("reserves the store and load names", reservesTheStoreAndLoadNames);
});

describeBackends("globals", () => {
  it("exposes globals as top-level functions without recording them as calls", () =>
    Effect.runPromise(exposesGlobalsAsTopLevelFunctions));

  it("groups namespaced globals and spreads arguments on request", () =>
    Effect.runPromise(groupsNamespacedGlobalsAndSpreadsArguments));

  it("names the members of a namespace when a script reads one that does not exist", () =>
    Effect.runPromise(namesTheMembersOfANamespace));

  it("rejects invalid and reserved global names", rejectsInvalidAndReservedGlobalNames);
});
