import { Type } from "@msa/ai";
import durable from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import codemode from "../src/codemode/codemode.ts";
import codemodeChatSupport from "./codemode-chat-support.ts";
import codemodeSupport from "./codemode-support.ts";
import support from "./support.ts";

const { defineTool } = durable;
const { CodemodeRunDoc } = codemode;

const { codemodeChat, tool } = codemodeChatSupport;
const {
  DONE,
  nestedCount,
  openStoredChat,
  removeDirectories,
  restart,
  resultText,
  script,
  sqlitePath,
} = codemodeSupport;
const { ControlledStorage, aborted, addTool, awaited, context, eventually, openChat } = support;

afterEach(removeDirectories);

function schemaErrorToolsChat() {
  const chat = codemodeChat();
  const Exit = Type.Object({ exitCode: Type.Number(), output: Type.String() });
  addTool(
    chat.setup.registry,
    defineTool({
      description: "run",
      execute: () =>
        Promise.resolve({
          isError: true,
          output: [{ text: "no matches", type: "text" }],
          structuredOutput: { exitCode: 1, output: "no matches" },
        }),
      name: "run",
      parameters: Type.Object({}),
      structuredOutputSchema: Exit,
    }),
  );
  addTool(
    chat.setup.registry,
    defineTool({
      description: "denied",
      execute: () =>
        Promise.resolve({
          isError: true,
          output: [{ text: "permission denied", type: "text" }],
        }),
      name: "denied",
      parameters: Type.Object({}),
      structuredOutputSchema: Exit,
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
        execute: (_args, _api, callContext) =>
          runPromise(Effect.suspend(() => awaited(aborted(callContext.abortSignal!)))),
        name: "forever",
      },
    ],
  });
  const { harness, result } = yield* restart(
    chat,
    `const k = load("k");
			if (k) tools.echo({ text: "new" }); else forever();
			await tools.hold({ id: k ? 2 : 1 });`,
    (opened, task) =>
      Effect.gen(function* () {
        const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          opened.commit(
            (tx) =>
              runNested(
                Effect.gen(function* () {
                  const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                  run.start!.store = { k: true };
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain('call 2 is tools.hold({"id":2}), but was tools.hold({"id":1})');
  expect(chat.echo.size).toBe(0);
  expect(yield* nestedCount(harness)).toBe(1);
  yield* awaited(harness.close(context));
});

const keepsGlobalUndefined = Effect.gen(function* () {
  const chat = codemodeChat({
    globals: [{ execute: () => Promise.resolve(undefined), name: "nothing" }],
  });
  const { harness, result } = yield* restart(
    chat,
    `const before = await nothing(); await tools.hold({}); return [before === undefined, (await nothing()) === undefined];`,
  );
  expect(result).toEqual({ isError: false, text: "[true,true]" });
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
        isError: true,
        output: [{ text: "permission denied", type: "text" }],
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
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    isError: false,
    text: '["permission denied","permission denied"]',
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
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    isError: false,
    text: '[1,"no matches",["permission denied",null]]',
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
      description: "picture",
      execute: (args) =>
        Promise.resolve({
          output: [
            ...(args.caption ? [{ text: "a cat", type: "text" as const }] : []),
            { data: PNG, mimeType: "image/png", type: "image" as const },
          ],
        }),
      name: "picture",
      parameters: Type.Object({ caption: Type.Boolean() }),
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
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    isError: false,
    text: '["a cat",""]',
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
        execute: () => {
          seen.push("first");
          storage.failNextCommit(new Error("lost"));
          return Promise.resolve(1);
        },
        name: "first",
      },
      {
        execute: () => {
          seen.push("second");
          return Promise.resolve(2);
        },
        name: "second",
      },
    ],
  });
  chat.holds.block = false;
  chat.setup.faux.setResponses([script(`await first(); await second();`), DONE]);
  const { harness, root } = yield* openChat(storage, chat.setup);
  yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* eventually(() => seen.includes("first"));
  yield* Effect.sleep(100);
  expect(seen).toEqual(["first"]);
  yield* awaited(harness.close(context).catch(() => {}));
});

describe("durable code mode", () => {
  it("delivers a result only after its journal commit", () =>
    Effect.runPromise(deliversResultOnly));
});
