import { type AssistantMessage } from "@msa/ai";
import { ToolResultEntry } from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import harnessToolsSupport from "./harness-tools-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSetup } = chatSupport;
const { awaited } = effectSupport;
const { addHooks, addTool } = harnessSupport;
const { DONE, calls, resultText, results, run, tool } = harnessToolsSupport;
const { context } = sessionSupport;

function validatingToolSetup() {
  const setup = chatSetup();
  const seen: { text?: string }[] = [];
  addTool(
    setup.registry,
    tool("echo", (args) => {
      seen.push(args);
      return Promise.resolve({ output: [] });
    }),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (call) => {
      if (call.id === "block") return { block: "not today" };
      if (call.id === "throw") throw new Error("hook failed");
      if (call.id === "bad") return { arguments: { text: { not: "a string" } } };
      return { arguments: { text: `${call.arguments["text"]}!` } };
    },
  });
  return { seen, setup };
}

const validatesArgumentsBeforeTool = Effect.gen(function* () {
  const { setup, seen } = validatingToolSetup();
  const { harness, entries } = yield* run(setup, [
    calls(
      ["echo", { text: 1 as unknown as string }, "coerced"],
      ["echo", { text: { not: "a string" } }, "invalid"],
      ["echo", {}, "block"],
      ["echo", {}, "throw"],
      ["echo", { text: "x" }, "bad"],
      ["echo", { text: "x" }, "ok"],
    ),
    DONE,
  ]);
  const byId = new Map(
    results(entries).map((result) => [result.toolCallId, [result.isError, resultText(result)]]),
  );
  expect(byId.get("block")).toEqual([
    true,
    "<harness>\n[error] Tool call blocked: not today\n</harness>",
  ]);
  expect(byId.get("throw")).toEqual([
    true,
    "<harness>\n[error] Tool call blocked: hook failed\n</harness>",
  ]);
  expect(byId.get("bad")![0]).toBe(true);
  expect(byId.get("bad")![1]).toContain("Validation failed");
  expect(byId.get("ok")).toEqual([false, ""]);
  expect(byId.get("invalid")![0]).toBe(true);
  expect(byId.get("invalid")![1]).toContain("Validation failed");
  expect(byId.get("coerced")).toEqual([false, ""]);
  expect(seen).toEqual(expect.arrayContaining([{ text: "1!" }, { text: "x!" }]));
  expect(seen).toHaveLength(2);
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("validates arguments before and after beforeTool and applies blocks and replacements", () =>
    Effect.runPromise(validatesArgumentsBeforeTool));
});

const repairsArgumentsPrepareArguments = Effect.gen(function* () {
  const setup = chatSetup();
  const seen: { text?: string }[] = [];
  addTool(
    setup.registry,
    tool(
      "echo",
      (args) => {
        seen.push(args);
        return Promise.resolve({ output: [] });
      },
      {
        prepareArguments: (args) => {
          const text = (args as { text?: unknown }).text;
          if (text === "throw") throw new Error("cannot repair");
          return typeof text === "number" ? { text: `#${text}` } : (args as { text?: string });
        },
      },
    ),
  );
  const { harness, entries } = yield* run(setup, [
    calls(
      ["echo", { text: 7 as unknown as string }, "fixed"],
      ["echo", { text: "throw" }, "broken"],
    ),
    DONE,
  ]);
  const byId = new Map(results(entries).map((result) => [result.toolCallId, resultText(result)]));
  expect(byId.get("fixed")).toBe("");
  expect(byId.get("broken")).toBe("<harness>\n[error] cannot repair\n</harness>");
  expect(seen).toEqual([{ text: "#7" }]);
  const call = (entries[2]!.model![0] as AssistantMessage).content.find(
    (item) => item.type === "toolCall",
  );
  expect(call?.type === "toolCall" && call.arguments).toEqual({ text: 7 });
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("repairs arguments with prepareArguments before validation, and a throwing repair is invalid", () =>
    Effect.runPromise(repairsArgumentsPrepareArguments));
});

const letsFirstBeforeTool = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("echo", () => Promise.resolve({ output: [] })),
  );
  const asked: string[] = [];
  addHooks(setup.registry, ToolTask, {
    beforeTool: () => {
      asked.push("first");
      return { block: "first says no" };
    },
  });
  addHooks(setup.registry, ToolTask, {
    beforeTool: () => {
      asked.push("second");
      return { block: "second says no" };
    },
  });
  const { harness, entries } = yield* run(setup, [calls(["echo", {}, "c1"]), DONE]);
  expect(asked).toEqual(["first"]);
  expect(resultText(results(entries)[0]!)).toBe(
    "<harness>\n[error] Tool call blocked: first says no\n</harness>",
  );
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("lets the first beforeTool block win and skips later handlers", () =>
    Effect.runPromise(letsFirstBeforeTool));
});

const chainsAfterToolReplacements = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("echo", () => Promise.resolve({ output: [{ text: "raw", type: "text" }] })),
  );
  addHooks(setup.registry, ToolTask, {
    afterTool: (_call, result) => ({ ...result, output: [{ text: "first", type: "text" }] }),
  });
  addHooks(setup.registry, ToolTask, {
    afterTool: (_call, result) => ({
      ...result,
      details: {
        replaced: (result.output ?? [])
          .map((item) => (item.type === "text" ? item.text : ""))
          .join("|"),
      },
    }),
  });
  const observed: unknown[] = [];
  addHooks(setup.registry, GenerationTask, {
    afterTools: (assistant, entries) => void observed.push(assistant, entries),
  });
  const { harness, entries } = yield* run(setup, [calls(["echo", {}, "c1"]), DONE]);
  const [result] = results(entries);
  expect(resultText(result!)).toBe("first");
  expect(result!.details).toEqual({ replaced: "first" });
  const resultEntry = entries.find((entry) => ToolResultEntry.is(entry))!;
  expect(observed).toEqual([entries[2]!.id, [resultEntry.id]]);
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("chains afterTool replacements and observes the round with afterTools", () =>
    Effect.runPromise(chainsAfterToolReplacements));
});
