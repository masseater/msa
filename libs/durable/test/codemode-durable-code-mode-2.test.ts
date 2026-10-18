import { Type } from "@msa/ai";
import { defineTool } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { CodemodeRunDoc } from "../src/codemode/codemode.ts";
import { openChat } from "./chat-support.ts";
import { codemodeChat, tool } from "./codemode-chat-support.ts";
import {
  restart,
  resultText,
  DONE,
  script,
  sqlitePath,
  nestedCount,
  removeDirectories,
  openStoredChat,
} from "./codemode-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { aborted, eventually } from "./task-support.ts";

afterEach(removeDirectories);

function schemaErrorToolsChat() {
  const chat = codemodeChat();
  const Exit = Type.Object({ output: Type.String(), exitCode: Type.Number() });
  addTool(
    chat.setup.registry,
    defineTool({
      name: "run",
      description: "run",
      parameters: Type.Object({}),
      structuredOutputSchema: Exit,
      execute: () =>
        Promise.resolve({
          output: [{ type: "text", text: "no matches" }],
          structuredOutput: { output: "no matches", exitCode: 1 },
          isError: true,
        }),
    }),
  );
  addTool(
    chat.setup.registry,
    defineTool({
      name: "denied",
      description: "denied",
      parameters: Type.Object({}),
      structuredOutputSchema: Exit,
      execute: () =>
        Promise.resolve({
          output: [{ type: "text", text: "permission denied" }],
          isError: true,
        }),
    }),
  );
  chat.holds.block = false;
  return { chat };
}

const checksEveryCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat({
    globals: [
      {
        name: "forever",
        execute: (_args, _api, callContext) =>
          runPromise(Effect.suspend(() => awaited(aborted(callContext.abortSignal!)))),
      },
    ],
  });
  const { harness, result } = yield* restart(
    chat,
    `const k = load("k");
			if (k) tools.echo({ text: "new" }); else forever();
			await tools.hold({ id: k ? 2 : 1 });`,
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    run.start!.store = { k: true };
                  }),
                ),
              context,
            ),
          );
        }),
      ),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain('call 2 is tools.hold({"id":2}), but was tools.hold({"id":1})');
  expect(chat.echo.size).toBe(0);
  expect(yield* nestedCount(harness)).toBe(1);
  yield* awaited(harness.close(context));
});

const keepsGlobalUndefined = Effect.gen(function* () {
  const chat = codemodeChat({
    globals: [{ name: "nothing", execute: () => Promise.resolve(undefined) }],
  });
  const { harness, result } = yield* restart(
    chat,
    `const before = await nothing(); await tools.hold({}); return [before === undefined, (await nothing()) === undefined];`,
  );
  expect(result).toEqual({ text: "[true,true]", isError: false });
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("checks every call a rerun holds before launching any of them", () =>
    Effect.runPromise(checksEveryCall));

  it("keeps a global's undefined result undefined, live and replayed", () =>
    Effect.runPromise(keepsGlobalUndefined));
});

const rejectsFailedTool = Effect.gen(function* () {
  const chat = codemodeChat();
  addTool(
    chat.setup.registry,
    tool("fails", () =>
      Promise.resolve({
        output: [{ type: "text", text: "permission denied" }],
        isError: true,
      }),
    ),
  );
  chat.holds.block = false;
  chat.setup.faux.setResponses([
    script(`try { await tools.fails({}); } catch (e) { return [e.message, e.structuredOutput]; }`),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    text: '["permission denied","permission denied"]',
    isError: false,
  });
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("rejects a failed tool call with its error text and structured output", () =>
    Effect.runPromise(rejectsFailedTool));
});

const resolvesSchemaTool = Effect.gen(function* () {
  const { chat } = schemaErrorToolsChat();
  chat.setup.faux.setResponses([
    script(
      `const r = await tools.run({});
				let e; try { await tools.denied({}); } catch (error) { e = [error.message, error.structuredOutput ?? null]; }
				return [r.exitCode, r.output, e];`,
    ),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    text: '[1,"no matches",["permission denied",null]]',
    isError: false,
  });
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("resolves a schema tool's error result that carries its value, and rejects one without with its text", () =>
    Effect.runPromise(resolvesSchemaTool));
});

const resolvesSchemaLess = Effect.gen(function* () {
  const chat = codemodeChat();
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  addTool(
    chat.setup.registry,
    defineTool({
      name: "picture",
      description: "picture",
      parameters: Type.Object({ caption: Type.Boolean() }),
      execute: (args) =>
        Promise.resolve({
          output: [
            ...(args.caption ? [{ type: "text" as const, text: "a cat" }] : []),
            { type: "image" as const, data: PNG, mimeType: "image/png" },
          ],
        }),
    }),
  );
  chat.holds.block = false;
  chat.setup.faux.setResponses([
    script(
      `return [await tools.picture({ caption: true }), await tools.picture({ caption: false })];`,
    ),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    text: '["a cat",""]',
    isError: false,
  });
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("resolves a schema-less tool with its text, as its declaration says, also when it returned images", () =>
    Effect.runPromise(resolvesSchemaLess));
});

const deliversResultOnly = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const seen: string[] = [];
  const chat = codemodeChat({
    globals: [
      {
        name: "first",
        execute: () => {
          seen.push("first");
          storage.failNextCommit(new Error("lost"));
          return Promise.resolve(1);
        },
      },
      {
        name: "second",
        execute: () => {
          seen.push("second");
          return Promise.resolve(2);
        },
      },
    ],
  });
  chat.holds.block = false;
  chat.setup.faux.setResponses([script(`await first(); await second();`), DONE]);
  const { harness, root } = yield* openChat(storage, chat.setup);
  yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* eventually(() => seen.includes("first"));
  yield* Effect.sleep(100);
  expect(seen).toEqual(["first"]);
  yield* awaited(harness.close(context).catch(() => {}));
});

describe("durable code mode", () => {
  it("delivers a result only after its journal commit", () =>
    Effect.runPromise(deliversResultOnly));
});

const refusesResumeSandbox = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  for (const field of ["fingerprint", "version"] as const) {
    const chat = codemodeChat();
    const { harness, result } = yield* restart(
      chat,
      `await tools.hold({}); await tools.echo({ text: "late" });`,
      (opened, task) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              opened.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                      if (field === "fingerprint") run.start!.fingerprint = "another sandbox";
                      else run.start!.version = 0;
                    }),
                  ),
                context,
              ),
            );
          }),
        ),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("cannot resume");
    expect(chat.echo.size).toBe(0);
    yield* awaited(harness.close(context));
  }
});

const timesScriptOut = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `// @options: {"timeout_ms": 60000}
			await tools.hold({}); await tools.echo({ text: "late" });`,
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    expect(run.start!.deadline).toBe(run.start!.startedAt + 60_000);
                    run.start!.deadline = currentTimeMillis();
                  }),
                ),
              context,
            ),
          );
        }),
      ),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("deadline passed");
  expect(chat.echo.size).toBe(0);
  expect(chat.vm.starts).toBe(1);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("refuses to resume when the sandbox's fingerprint or the code mode version changed", () =>
    Effect.runPromise(refusesResumeSandbox));

  it("times a script out across a restart, without admitting new calls", () =>
    Effect.runPromise(timesScriptOut));
});
