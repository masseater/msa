import { Type } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessStructuredOutputSupport from "./harness-structured-output-support.ts";
import support from "./support.ts";

const { NestedCallDoc, defineTool } = durable;
const { MemoryStorage } = memory;
const { watchEvents } = harnessModule;

const { Count, DONE, call, codes, direct, nested, returning } = harnessStructuredOutputSupport;
const { addTool, awaited, chatSetup, context, openChat, toJsonText } = support;

const probingStructuredTools = Effect.fn("probingStructuredTools")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, returning("plain", { output: [{ text: "a", type: "text" }] }));
  addTool(
    setup.registry,
    returning("nothing", { structuredOutput: null }, { structuredOutputSchema: Type.Null() }),
  );
  const received: durableTypes.NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    defineTool({
      description: "probe",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            received.push(yield* awaited(api.executeTool("plain", {}, callContext)));
            received.push(yield* awaited(api.executeTool("nothing", {}, callContext)));
            return {};
          }),
        ),
      name: "probe",
      parameters: Type.Object({}),
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const storage = new MemoryStorage();
  const { harness, root } = yield* openChat(storage, setup);
  return { harness, received, root };
});

const givesCallersSchema = Effect.gen(function* () {
  const text = { text: "one", type: "text" as const };
  const image = { data: "AAAA", mimeType: "image/png", type: "image" as const };
  const cases: [output: (typeof text | typeof image)[], value: chordTypes.JsonValue][] = [
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
      diagnostics: [],
      durationMs: received.durationMs,
      isError: false,
      structuredOutput: value,
      taskId: received.taskId,
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
        diagnostics: [{ message: "note", severity: "info" }],
        output: [{ text: "a\nb\nc", type: "text" }],
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
  const stored: chordTypes.JsonValue[] = [];
  harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type !== "document" || change.record.kind !== NestedCallDoc.definition.kind)
        continue;
      const result = (change.value as durableTypes.NestedCallState | null)?.result;
      if (result !== undefined && change.ops.length > 0)
        stored.push(result as unknown as chordTypes.JsonValue);
    }
  });
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const ends: durableTypes.NestedToolExecutionResult[] = [];
  stream.start((batch) => {
    for (const event of batch) {
      if (event.type === "tool_execution_end" && event.parentToolCallId !== undefined) {
        ends.push(event.result as durableTypes.NestedToolExecutionResult);
      }
    }

    return Promise.resolve();
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));

  expect(received[0]).toMatchObject({ isError: false, structuredOutput: "a" });
  expect(received[1]).toMatchObject({ isError: false, structuredOutput: null });
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
    output: [{ text: "3 things", type: "text" as const }],
    structuredOutput: { count: 3 },
  };
  addTool(setup.registry, returning("counter", result, { structuredOutputSchema: Count }));
  expect(yield* nested(setup, "counter")).toMatchObject({
    isError: false,
    structuredOutput: { count: 3 },
  });

  const modelSetup = chatSetup();
  addTool(modelSetup.registry, returning("counter", result, { structuredOutputSchema: Count }));
  const stored = yield* direct(modelSetup, "counter");
  expect(stored).toMatchObject({
    content: [{ text: "3 things", type: "text" }],
    isError: false,
  });
  expect(stored).not.toHaveProperty("structuredOutput");
});

describe("structured output", () => {
  it("gives callers a schema tool's validated structured output, which the transcript does not store", () =>
    Effect.runPromise(givesCallersSchemaTool));
});

const turnsStructuredOutput = Effect.gen(function* () {
  const cases: [
    name: string,
    result: durableTypes.ToolExecutionResult,
    schema: boolean,
    message: string,
  ][] = [
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
