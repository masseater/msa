import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import sandboxSupport from "./sandbox-support.ts";

const { closeSandboxes, createSandbox, describeBackends, echo } = sandboxSupport;

const hasNoHostGlobals = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				return [
					typeof process, typeof require, typeof module, typeof setTimeout, typeof fetch,
					typeof WebAssembly, typeof std, typeof os, typeof globalThis.constructor,
				]
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: [
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "function",
    ],
  });
});

const keepsEvalAndFunctionInsideThe = Effect.gen(function* () {
  const sandbox = createSandbox([echo]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				return [
					eval("typeof process"),
					new Function("return typeof process")(),
					tools.echo.constructor("return typeof require")(),
					(async () => {}).constructor("return typeof setTimeout")() instanceof Promise,
				];
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: ["undefined", "undefined", "undefined", true],
  });
});

const rejectsDynamicImport = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				try { await import("node:fs"); return "imported"; } catch (error) { return error.constructor.name; }
			`),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).not.toBe("imported");
});

const ignoresPatchesToBuiltInsAnd = Effect.gen(function* () {
  const sandbox = createSandbox([echo]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				Array.prototype.toJSON = () => null;
				Object.prototype.toJSON = () => 5;
				Promise.prototype.then = () => {};
				Map.prototype.get = () => undefined;
				globalThis.JSON = { stringify: () => "x", parse: () => "x" };
				store("k", [1]);
				return [await tools.echo([2]), JSON.stringify({ a: 1 })];
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    storeWrites: { set: { k: [1] } },
    value: [[2], '{"a":1}'],
  });
});

const freezesIntrinsicsThatAreOnlyReachable = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				return [
					Object.getPrototypeOf(function* () {}).prototype,
					Object.getPrototypeOf(async function () {}),
					Object.getPrototypeOf(Int8Array).prototype,
					Object.getPrototypeOf([][Symbol.iterator]()),
					Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
					Object.getPrototypeOf(new Map()[Symbol.iterator]()),
					Object.getPrototypeOf(/a/[Symbol.matchAll]("")),
				].every((object) => Object.isFrozen(object));
			`),
  );
  expect(result).toMatchObject({ ok: true, value: true });
});

const stillLetsInstancesOverridePropertiesOf = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				const object = {};
				object.toString = () => "custom";
				function Legacy() {}
				Legacy.prototype = Object.create(Error.prototype);
				Legacy.prototype.constructor = Legacy;
				const bare = new Error();
				bare.message = "set later";
				class MyError extends Error {
					constructor(message) {
						super(message);
						this.name = "MyError";
					}
				}
				let patched = "silent";
				try { Error.prototype.name = "Patched"; } catch (error) { patched = error.constructor.name; }
				return [String(object), new Legacy().constructor === Legacy, bare.message, new MyError("x").name, Error.prototype.name, patched];
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: ["custom", true, "set later", "MyError", "Error", "TypeError"],
  });
});

const reportsErrorsWhoseNameOrMessage = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute("const error = new Error('x'); error.message = 42; throw error;"),
  );
  expect(result).toMatchObject({
    error: { kind: "script", message: "42", name: "Error" },
    ok: false,
  });
});

const keepsToolsAndConsoleFrozen = Effect.gen(function* () {
  const sandbox = createSandbox([echo]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				try { tools.echo = () => 'nope'; } catch {}
				try { tools.extra = () => 'nope'; } catch {}
				try { globalThis.tools = null; } catch {}
				return ["extra" in tools, await tools.echo('still')];
			`),
  );
  expect(result).toMatchObject({ ok: true, value: [false, "still"] });
});

afterEach(closeSandboxes);

describeBackends("escape hatches", () => {
  it("has no host globals", () => Effect.runPromise(hasNoHostGlobals));

  it("keeps eval and Function inside the VM", () =>
    Effect.runPromise(keepsEvalAndFunctionInsideThe));

  it("rejects dynamic import", () => Effect.runPromise(rejectsDynamicImport));

  it("ignores patches to built-ins and built-in globals", () =>
    Effect.runPromise(ignoresPatchesToBuiltInsAnd));

  it("freezes intrinsics that are only reachable from instances", () =>
    Effect.runPromise(freezesIntrinsicsThatAreOnlyReachable));

  it("still lets instances override properties of frozen prototypes", () =>
    Effect.runPromise(stillLetsInstancesOverridePropertiesOf));

  it("reports errors whose name or message is not a string", () =>
    Effect.runPromise(reportsErrorsWhoseNameOrMessage));

  it("keeps tools and console frozen", () => Effect.runPromise(keepsToolsAndConsoleFrozen));
});
