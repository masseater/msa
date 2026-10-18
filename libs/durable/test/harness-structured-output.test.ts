import { Type } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import {
  defineTool,
  NestedCallDoc,
  type NestedCallState,
  type NestedToolExecutionResult,
  type ToolExecutionResult,
} from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import {
  direct,
  DONE,
  call,
  Count,
  returning,
  codes,
  nested,
} from "./harness-structured-output-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

const probingStructuredTools = Effect.fn("probingStructuredTools")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, returning("plain", { output: [{ type: "text", text: "a" }] }));
  addTool(
    setup.registry,
    returning("nothing", { structuredOutput: null }, { structuredOutputSchema: Type.Null() }),
  );
  const received: NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    defineTool({
      name: "probe",
      description: "probe",
      parameters: Type.Object({}),
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            received.push(yield* awaited(api.executeTool("plain", {}, callContext)));
            received.push(yield* awaited(api.executeTool("nothing", {}, callContext)));
            return {};
          }),
        ),
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const storage = new MemoryStorage();
  const { harness, root } = yield* openChat(storage, setup);
  return { received, harness, root };
});

const givesCallersSchema = Effect.gen(function* () {
  const text = { type: "text" as const, text: "one" };
  const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
  const cases: [output: (typeof text | typeof image)[], value: JsonValue][] = [
    [[text], "one"],
    [[image], image],
    [[], ""],
    [
      [text, image],
      [text, image],
    ],
    [
      [text, text],
      [text, text],
    ],
  ];
  for (const [output, value] of cases) {
    const setup = chatSetup();
    addTool(setup.registry, returning("plain", { output }));
    const received = yield* nested(setup, "plain");
    expect(received).toEqual({
      taskId: received.taskId,
      structuredOutput: value,
      isError: false,
      diagnostics: [],
      durationMs: received.durationMs,
    });
  }
});

const givesCallersBounded = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    returning(
      "long",
      {
        output: [{ type: "text", text: "a\nb\nc" }],
        diagnostics: [{ severity: "info", message: "note" }],
      },
      { outputLimits: { maxLines: 1 } },
    ),
  );
  const received = yield* nested(setup, "long");
  expect(received.structuredOutput).toBe("a\n");
  expect(codes(received)).toEqual([undefined, "truncated"]);
});

describe("structured output", () => {
  it("gives callers a schema-less tool's output: one text as a string, one image as itself, else the list", () =>
    Effect.runPromise(givesCallersSchema));

  it("gives callers the bounded output, as the model sees it, without the rendered diagnostics", () =>
    Effect.runPromise(givesCallersBounded));
});

const storesExactlyWhat = Effect.gen(function* () {
  const { received, harness, root } = yield* probingStructuredTools();
  const stored: JsonValue[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type !== "document" || change.record.kind !== NestedCallDoc.definition.kind)
        continue;
      const result = (change.value as NestedCallState | null)?.result;
      if (result !== undefined && change.ops.length > 0)
        stored.push(result as unknown as JsonValue);
    }
  });
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const ends: NestedToolExecutionResult[] = [];
  stream.start((batch) => {
    for (const event of batch) {
      if (event.type === "tool_execution_end" && event.parentToolCallId !== undefined) {
        ends.push(event.result as NestedToolExecutionResult);
      }
    }

    return Promise.resolve();
  });
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));

  expect(received[0]).toMatchObject({ structuredOutput: "a", isError: false });
  expect(received[1]).toMatchObject({ structuredOutput: null, isError: false });
  expect(received[0]).not.toHaveProperty("output");
  expect(stored).toEqual(received);
  expect(ends).toEqual(received);
});

describe("structured output", () => {
  it("stores exactly what callers and events get, without the model's output, and keeps a stored null", () =>
    Effect.runPromise(storesExactlyWhat));
});

const givesCallersSchemaTool = Effect.gen(function* () {
  const setup = chatSetup();
  const result = {
    output: [{ type: "text" as const, text: "3 things" }],
    structuredOutput: { count: 3 },
  };
  addTool(setup.registry, returning("counter", result, { structuredOutputSchema: Count }));
  expect(yield* nested(setup, "counter")).toMatchObject({
    structuredOutput: { count: 3 },
    isError: false,
  });

  const modelSetup = chatSetup();
  addTool(modelSetup.registry, returning("counter", result, { structuredOutputSchema: Count }));
  const stored = yield* direct(modelSetup, "counter");
  expect(stored).toMatchObject({
    isError: false,
    content: [{ type: "text", text: "3 things" }],
  });
  expect(stored).not.toHaveProperty("structuredOutput");
});

describe("structured output", () => {
  it("gives callers a schema tool's validated structured output, which the transcript does not store", () =>
    Effect.runPromise(givesCallersSchemaTool));
});

const turnsStructuredOutput = Effect.gen(function* () {
  const cases: [name: string, result: ToolExecutionResult, schema: boolean, message: string][] = [
    ["wrong", { structuredOutput: { count: "three" } }, true, "does not match its schema: count:"],
    ["missing", { output: [] }, true, "returned no structuredOutput"],
    ["undeclared", { structuredOutput: { count: 3 } }, false, "declares no structuredOutputSchema"],
  ];
  for (const [name, result, schema, message] of cases) {
    const setup = chatSetup();
    addTool(
      setup.registry,
      returning(name, result, schema ? { structuredOutputSchema: Count } : {}),
    );
    const received = yield* nested(setup, name);
    expect(received.isError).toBe(true);
    if (schema) expect(received).not.toHaveProperty("structuredOutput");
    else expect(received.structuredOutput).toBe("");
    expect(codes(received)).toEqual(["invalid_structured_output"]);
    expect(received.diagnostics[0]?.message).toContain(message);

    const modelSetup = chatSetup();
    addTool(
      modelSetup.registry,
      returning(name, result, schema ? { structuredOutputSchema: Count } : {}),
    );
    const stored = yield* direct(modelSetup, name);
    expect(stored.isError).toBe(false);
    expect(yield* toJsonText(stored.content)).not.toContain(message);
    expect(modelSetup.reports.map((error) => (error as Error).message).join("\n")).toContain(
      message,
    );
  }
});

describe("structured output", () => {
  it("turns structured output that breaks the schema into an error result for callers, and a report for the model's calls", () =>
    Effect.runPromise(turnsStructuredOutput));
});
