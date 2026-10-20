import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import sandboxSupport from "./sandbox-support.ts";

const { closeSandboxes, createSandbox, delayed, describeBackends, echo, rejectOnAbort } =
  sandboxSupport;

const exposesToolsAsAsyncFunctionsAnd = Effect.gen(function* () {
  const seen: unknown[] = [];
  const sandbox = createSandbox([
    {
      execute: (args) => {
        seen.push(args);
        const { a, b } = args as { a: number; b: number };
        return { sum: a + b };
      },
      name: "add",
    },
  ]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				const first = await tools.add({ a: 1, b: 2 });
				const second = await tools.add({ a: first.sum, b: 10 });
				return second.sum;
			`),
  );
  expect(result).toMatchObject({ ok: true, value: 13 });
  expect(seen).toEqual([
    { a: 1, b: 2 },
    { a: 3, b: 10 },
  ]);
  expect(result.calls.map((call) => [call.name, call.status])).toEqual([
    ["add", "ok"],
    ["add", "ok"],
  ]);
  expect(result.calls.every((call) => call.durationMs >= 0)).toBe(true);
});

const runsConcurrentCallsAndListsTool = Effect.gen(function* () {
  const sandbox = createSandbox([
    echo,
    {
      execute: (args) => delayed(20, args),
      name: "delay",
    },
  ]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				const [a, b, c] = await Promise.all([tools.delay(1), tools.delay(2), tools.echo(3)]);
				return { values: [a, b, c], names: Object.keys(tools) };
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: { names: ["echo", "delay"], values: [1, 2, 3] },
  });
});

const exposesToolsUnderNormalizedIdentifiersAnd = Effect.gen(function* () {
  const sandbox = createSandbox([
    { description: "Dashes", execute: () => "dash", name: "my-tool" },
    { description: "Shadowed", execute: () => "underscore", name: "my_tool" },
    { execute: () => "mcp", name: "mcp__docs__search" },
  ]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				try { ALL_TOOLS.push({}); } catch {}
				return {
					all: ALL_TOOLS,
					calls: [await tools.my_tool(), await tools["my-tool"](), await tools.mcp__docs__search()],
				};
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      all: [
        { description: "Dashes", name: "my_tool" },
        { description: "", name: "mcp__docs__search" },
      ],
      calls: ["dash", "dash", "mcp"],
    },
  });
});

const passesUndefinedArgumentsAndResultsThrough = Effect.gen(function* () {
  const sandbox = createSandbox([{ execute: (args) => args, name: "noop" }]);
  const result = yield* Effect.promise(() =>
    sandbox.execute("return [await tools.noop(), await tools.noop(null)]"),
  );
  expect(result).toMatchObject({ ok: true, value: [null, null] });
});

const turnsToolErrorsIntoCatchableErrors = Effect.gen(function* () {
  const sandbox = createSandbox([
    {
      execute: () => {
        throw new Error("tool exploded");
      },
      name: "fail",
    },
  ]);
  const result = yield* Effect.promise(() =>
    sandbox.execute(`
				try {
					await tools.fail();
					return "no error";
				} catch (error) {
					return { isError: error instanceof Error, message: error.message };
				}
			`),
  );
  expect(result).toMatchObject({
    ok: true,
    value: { isError: true, message: "tool exploded" },
  });
  expect(result.calls).toMatchObject([{ name: "fail", status: "error" }]);
});

const rejectsCallsToUnknownTools = Effect.gen(function* () {
  const sandbox = createSandbox();
  const result = yield* Effect.promise(() => sandbox.execute("return await tools.missing()"));
  expect(result).toMatchObject({ error: { kind: "script", name: "TypeError" }, ok: false });
});

const abortsUnawaitedCallsWhenTheScript = Effect.gen(function* () {
  let aborted = false;
  const sandbox = createSandbox([
    {
      execute: (_args, { signal }) =>
        rejectOnAbort(signal, () => {
          aborted = true;
        }),
      name: "slow",
    },
  ]);
  const result = yield* Effect.promise(() => sandbox.execute("tools.slow(); return 'early'"));
  expect(result).toMatchObject({ ok: true, value: "early" });
  expect(result.calls).toMatchObject([{ name: "slow", status: "cancelled" }]);
  expect(aborted).toBe(true);
});

const namesCloseMatchesWhenAScript = Effect.gen(function* () {
  const sandbox = createSandbox([echo, { execute: () => "", name: "web-search" }]);
  const attempt = (expression: string) =>
    sandbox
      .execute(`return ${expression};`)
      .then((result) => (result.ok ? result.value : result.error.message));
  expect(yield* Effect.promise(() => attempt("tools.Echo"))).toBe(
    'tools.Echo does not exist. Did you mean tools.echo? ALL_TOOLS lists every tool; searchTools(query) finds tools by topic. Check for a member with "Echo" in tools.',
  );
  expect(yield* Effect.promise(() => attempt("tools.websearch"))).toContain(
    "Did you mean tools.web_search?",
  );
  expect(yield* Effect.promise(() => attempt("tools.nothing"))).toContain(
    "Available: echo, web_search.",
  );
  expect(
    yield* Effect.promise(() =>
      attempt(
        "['echo' in tools, 'nothing' in tools, String(tools.toString), JSON.stringify(tools)]",
      ),
    ),
  ).toEqual([true, false, "undefined", "{}"]);
});

const supportsRegisterAndUnregisterBetweenExecutions = Effect.gen(function* () {
  const sandbox = createSandbox();
  sandbox.registerTool(echo);
  expect(() => sandbox.registerTool(echo)).toThrow(/already registered/u);
  expect(sandbox.tools.map((tool) => tool.name)).toEqual(["echo"]);
  expect(
    yield* Effect.promise(() => sandbox.execute("return await tools.echo('a')")),
  ).toMatchObject({
    ok: true,
    value: "a",
  });
  expect(sandbox.unregisterTool("echo")).toBe(true);
  expect(yield* Effect.promise(() => sandbox.execute("return 'echo' in tools"))).toMatchObject({
    ok: true,
    value: false,
  });
});

afterEach(closeSandboxes);

describeBackends("tools", () => {
  it("exposes tools as async functions and records calls", () =>
    Effect.runPromise(exposesToolsAsAsyncFunctionsAnd));

  it("runs concurrent calls and lists tool names", () =>
    Effect.runPromise(runsConcurrentCallsAndListsTool));

  it("exposes tools under normalized identifiers and lists them in ALL_TOOLS", () =>
    Effect.runPromise(exposesToolsUnderNormalizedIdentifiersAnd));

  it("passes undefined arguments and results through", () =>
    Effect.runPromise(passesUndefinedArgumentsAndResultsThrough));

  it("turns tool errors into catchable Errors in the script", () =>
    Effect.runPromise(turnsToolErrorsIntoCatchableErrors));

  it("rejects calls to unknown tools", () => Effect.runPromise(rejectsCallsToUnknownTools));

  it("aborts unawaited calls when the script returns", () =>
    Effect.runPromise(abortsUnawaitedCallsWhenTheScript));

  it("names close matches when a script reads a tool that does not exist", () =>
    Effect.runPromise(namesCloseMatchesWhenAScript));

  it("supports register and unregister between executions", () =>
    Effect.runPromise(supportsRegisterAndUnregisterBetweenExecutions));
});
