import vm from "node:vm";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { PRELUDE_SOURCE } from "../src/runtime/prelude-source.ts";
import {
  closeSandboxes,
  createSandbox,
  describeBackends,
  echo,
  GIF,
  JPEG,
  PNG,
  WEBP,
} from "./sandbox-support.ts";
import { toJson } from "./support.ts";

function parseAsJavascript(): void {
  expect(() => new vm.Script(PRELUDE_SOURCE, { filename: "prelude.js" })).not.toThrow();
}

const returnsTheScriptSReturnValue = Effect.gen(function* () {
  const sandbox = createSandbox();
  expect(
    yield* Effect.promise(() => sandbox.execute("return { a: 1, b: [true, 'x'] }")),
  ).toMatchObject({
    ok: true,
    value: { a: 1, b: [true, "x"] },
    output: [],
    calls: [],
  });
  expect(yield* Effect.promise(() => sandbox.execute("return 'plain'"))).toMatchObject({
    ok: true,
    value: "plain",
  });
  expect(yield* Effect.promise(() => sandbox.execute(""))).toMatchObject({
    ok: true,
    value: undefined,
  });
});

const supportsTopLevelAwait = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute("const x = await Promise.resolve(41); return x + 1"),
  );
  expect(result).toMatchObject({ ok: true, value: 42 });
});

const collectsTextImageAndConsoleOutput = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				console.log("hello", 1, { a: 1 });
				text({ json: true });
				text(undefined);
				text(7);
				image("data:image/png;base64,${PNG}");
				image({ image_url: "data:image/jpeg;base64,${JPEG}" });
				image({ type: "image", data: "${GIF}", mimeType: "image/gif" });
				image("data:image/png;base64,${WEBP}");
				image({ type: "image", data: "${PNG}" });
				console.error(new Error("bad"));
				return null;
			`),
  );
  expect(result.ok).toBe(true);
  expect(result.output.slice(0, -1)).toEqual([
    { type: "text", text: 'hello 1 {"a":1}', console: true },
    { type: "text", text: '{"json":true}' },
    { type: "text", text: "undefined" },
    { type: "text", text: "7" },
    { type: "image", data: PNG, mimeType: "image/png" },
    { type: "image", data: JPEG, mimeType: "image/jpeg" },
    { type: "image", data: GIF, mimeType: "image/gif" },
    { type: "image", data: WEBP, mimeType: "image/webp" },
    { type: "image", data: PNG, mimeType: "image/png" },
  ]);
  expect(result.output.at(-1)).toMatchObject({
    type: "text",
    text: expect.stringMatching(/^Error: bad/u),
    console: true,
  });
});

const rejectsInvalidTextAndImageArguments = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				const errors = [];
				const circular = {};
				circular.self = circular;
				for (const run of [
					() => text(circular),
					() => image(""),
					() => image("https://example.com/a.png"),
					() => image("data:image/png,raw"),
					() => image({ type: "text", text: "x" }),
					() => image({ type: "image", data: "" }),
					() => image(42),
					() => image("data:image/png;base64,AAAA!"),
					() => image("data:image/png;base64,AAAAA"),
					() => image("data:image/png;base64,AA=A"),
					() => image("data:image/png;base64,"),
					() => image("data:image/png;base64,AAAA\\n[Output truncated]"),
					() => image({ type: "image", data: "AAAA!", mimeType: "image/png" }),
					() => image("data:image/png;base64,AAAA"),
					() => image("data:image/png;base64,QUJD"),
					() => image("data:image/jpeg;base64,/9j/9w=="),
				]) {
					try { run(); errors.push("no error"); } catch (error) { errors.push(error.name + ": " + error.message); }
				}
				return errors;
			`),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.output).toEqual([]);
  const errors = result.value as string[];
  expect(errors[0]).toMatch(/^TypeError: .*circular/u);
  expect(errors.slice(1)).toEqual([
    'TypeError: image expects a non-empty image URL string, an object with image_url, or an image block { type: "image", data, mimeType }',
    "TypeError: remote image URLs are not supported in tool outputs. Pass a base64 data URI instead",
    "TypeError: invalid image output. Pass a base64 data URI instead",
    'TypeError: image only accepts image blocks, got "text"',
    "TypeError: image expected image block data",
    'TypeError: image expects a non-empty image URL string, an object with image_url, or an image block { type: "image", data, mimeType }',
    ...Array(6).fill(
      "TypeError: invalid image output. The image data is not valid base64 (truncated or corrupted?)",
    ),
    ...Array(3).fill(
      "TypeError: invalid image output. The image data is not a PNG, JPEG, GIF, or WebP image",
    ),
  ]);
});

const acceptsWrappedAndLargeBase64Image = Effect.gen(function* () {
  const sandbox = createSandbox();
  const large = `iVBORw0KGgoA${"QUJD".repeat(256 * 1024)}`;
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				image("data:image/png;base64,iVBORw0K\\r\\nGgo=\\n");
				image("data:image/png;base64,${large}");
			`),
  );
  expect(result.ok).toBe(true);
  expect(result.output).toEqual([
    { type: "image", data: PNG, mimeType: "image/png" },
    { type: "image", data: large, mimeType: "image/png" },
  ]);
});

const endsTheScriptSuccessfullyOnExit = Effect.gen(function* () {
  const sandbox = createSandbox([echo]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				text("before");
				store("k", 1);
				await tools.echo(1);
				try { exit(); } catch {}
				text("after");
				return "unreachable";
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: undefined,
    output: [{ type: "text", text: "before" }],
    storeWrites: { set: { k: 1 }, delete: [] },
  });
});

const keepsOutputProducedBeforeAFailure = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute('text("partial");\nthrow new Error("boom")'),
  );
  expect(result).toMatchObject({ ok: false, output: [{ type: "text", text: "partial" }] });
});

const reportsSyntaxErrorsWithTheScript = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute("const a = 1;\nconst b = ;\nreturn a"),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("script");
  expect(result.error.name).toBe("SyntaxError");
  expect(result.error.stack).toMatch(/codemode\.js:2/u);
});

const reportsThrownErrorsWithTheScript = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute("const a = 1;\nthrow new TypeError('boom ' + a)"),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatchObject({ kind: "script", name: "TypeError", message: "boom 1" });
  expect(result.error.stack).toMatch(/codemode\.js:2/u);
});

const formatsStacksLikeV8WithoutPrelude = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() =>
    sandbox.execute("console.log(new Error('inner'));\nthrow new RangeError('outer')"),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.stack).toMatch(/^RangeError: outer\n {4}at .*codemode\.js:2/u);
  expect(result.error.stack).not.toContain("codemode-prelude.js");
  expect(result.output[0]).toMatchObject({
    type: "text",
    text: expect.stringMatching(/^Error: inner\n {4}at .*codemode\.js:1/u),
  });
  expect(yield* toJson(result.output)).not.toContain("codemode-prelude.js");
});

const reportsNonErrorThrows = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() => sandbox.execute("throw { code: 7 }"));
  expect(result).toMatchObject({ ok: false, error: { kind: "script", message: '{"code":7}' } });
});

const reportsANonSerializableReturnValue = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() => sandbox.execute("return 10n"));
  expect(result).toMatchObject({ ok: false, error: { kind: "script", name: "TypeError" } });
});

afterEach(closeSandboxes);

describe("embedded sources", () => {
  it("parse as JavaScript", parseAsJavascript);
});

describeBackends("script execution", () => {
  it("returns the script's return value after a JSON round trip", () =>
    Effect.runPromise(returnsTheScriptSReturnValue));

  it("supports top-level await", () => Effect.runPromise(supportsTopLevelAwait));

  it("collects text(), image(), and console output in order", () =>
    Effect.runPromise(collectsTextImageAndConsoleOutput));

  it("rejects invalid text() and image() arguments", () =>
    Effect.runPromise(rejectsInvalidTextAndImageArguments));

  it("accepts wrapped and large base64 image data", () =>
    Effect.runPromise(acceptsWrappedAndLargeBase64Image));

  it("ends the script successfully on exit(), keeping output and store writes", () =>
    Effect.runPromise(endsTheScriptSuccessfullyOnExit));

  it("keeps output produced before a failure", () =>
    Effect.runPromise(keepsOutputProducedBeforeAFailure));

  it("reports syntax errors with the script's line number", () =>
    Effect.runPromise(reportsSyntaxErrorsWithTheScript));

  it("reports thrown errors with the script's line number", () =>
    Effect.runPromise(reportsThrownErrorsWithTheScript));

  it("formats stacks like V8 without prelude frames", () =>
    Effect.runPromise(formatsStacksLikeV8WithoutPrelude));

  it("reports non-Error throws", () => Effect.runPromise(reportsNonErrorThrows));

  it("reports a non-serializable return value as a script error", () =>
    Effect.runPromise(reportsANonSerializableReturnValue));
});
