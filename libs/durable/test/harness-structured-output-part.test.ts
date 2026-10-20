import ai from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessStructuredOutputSupport from "./harness-structured-output-support.ts";
import support from "./support.ts";

const { Type } = ai;

const { defineTool } = durable;
const { ToolTask } = harnessModule;
const { MemoryStorage } = memory;

const { Count, DONE, call, codes, direct, nested, returning } = harnessStructuredOutputSupport;
const { addHooks, addTool, awaited, chatSetup, context, openChat } = support;

const expectErrorTextAsDiagnostic = Effect.fn("expectErrorTextAsDiagnostic")(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    returning(
      "fails",
      { isError: true, output: [{ text: "nope", type: "text" }] },
      { structuredOutputSchema: Count },
    ),
  );
  const received = yield* nested(setup, "fails");
  expect(received).toMatchObject({
    diagnostics: [{ code: "tool_error", message: "nope", severity: "error" }],
    isError: true,
  });
  expect(received).not.toHaveProperty("structuredOutput");
});

const expectModelKeepsErrorText = Effect.fn("expectModelKeepsErrorText")(function* () {
  const modelSetup = chatSetup();
  addTool(
    modelSetup.registry,
    returning(
      "fails",
      { isError: true, output: [{ text: "nope", type: "text" }] },
      { structuredOutputSchema: Count },
    ),
  );
  const stored = yield* direct(modelSetup, "fails");
  expect(stored.content).toEqual([{ text: "nope", type: "text" }]);
});

const expectThrownErrorDiagnostic = Effect.fn("expectThrownErrorDiagnostic")(function* () {
  const thrown = chatSetup();
  addTool(
    thrown.registry,
    defineTool({
      description: "throws",
      execute: () => Promise.reject(new Error("permission denied")),
      name: "throws",
      parameters: Type.Object({}),
      structuredOutputSchema: Count,
    }),
  );
  const thrownResult = yield* nested(thrown, "throws");
  expect(thrownResult).toMatchObject({
    diagnostics: [{ code: "tool_error", message: "permission denied" }],
    isError: true,
  });
  expect(thrownResult.diagnostics).toHaveLength(1);
  expect(thrownResult).not.toHaveProperty("structuredOutput");
});

const expectOwnDiagnosticsOnly = Effect.fn("expectOwnDiagnosticsOnly")(function* () {
  const explained = chatSetup();
  addTool(
    explained.registry,
    returning(
      "fails",
      {
        diagnostics: [{ code: "quota", message: "quota exceeded", severity: "error" }],
        isError: true,
        output: [{ text: "partial log", type: "text" }],
      },
      { structuredOutputSchema: Count },
    ),
  );
  expect((yield* nested(explained, "fails")).diagnostics).toEqual([
    { code: "quota", message: "quota exceeded", severity: "error" },
  ]);
});

const expectErrorKeepsStructuredOutput = Effect.fn("expectErrorKeepsStructuredOutput")(
  function* () {
    const kept = chatSetup();
    const withValue = {
      isError: true,
      output: [{ text: "nope", type: "text" as const }],
      structuredOutput: { count: 0 },
    };
    addTool(kept.registry, returning("fails", withValue, { structuredOutputSchema: Count }));
    expect(yield* nested(kept, "fails")).toMatchObject({
      isError: true,
      structuredOutput: { count: 0 },
    });
  },
);

const givesCallersOutput = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    returning("bad", { isError: true, output: [{ text: "bad", type: "text" }] }),
  );
  expect(yield* nested(setup, "bad")).toMatchObject({
    isError: true,
    structuredOutput: "bad",
  });
});

const givesCallersNo = Effect.gen(function* () {
  const setup = chatSetup();
  const received = yield* nested(setup, "missing");
  expect(received).toMatchObject({
    diagnostics: [{ code: "tool_unavailable" }],
    isError: true,
  });
  expect(received).not.toHaveProperty("structuredOutput");
});

const givesCallersSchema = Effect.gen(function* () {
  yield* expectErrorTextAsDiagnostic();
  yield* expectModelKeepsErrorText();
  yield* expectThrownErrorDiagnostic();
  yield* expectOwnDiagnosticsOnly();
  yield* expectErrorKeepsStructuredOutput();
});

describe("structured output", () => {
  it("gives callers the output of an error result of a tool without a schema", () =>
    Effect.runPromise(givesCallersOutput));

  it("gives callers no structured output for an error result the Harness wrote, only diagnostics", () =>
    Effect.runPromise(givesCallersNo));

  it("gives callers a schema tool's error text as a diagnostic, never as structured output", () =>
    Effect.runPromise(givesCallersSchema));
});

const keepsStructuredOutputStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, returning("plain", { output: [{ text: "secret", type: "text" }] }));
  addTool(
    setup.registry,
    returning("counter", { structuredOutput: { count: 1 } }, { structuredOutputSchema: Count }),
  );
  addTool(
    setup.registry,
    returning("other", { structuredOutput: { count: 1 } }, { structuredOutputSchema: Count }),
  );
  addHooks(setup.registry, ToolTask, {
    afterTool: (hookCall, result) =>
      hookCall.name === "other"
        ? { ...result, structuredOutput: { count: "broken" } as unknown as chordTypes.JsonValue }
        : hookCall.name === "probe"
          ? result
          : { ...result, output: [{ text: "rewritten", type: "text" }] },
  });
  return { runPromise, setup };
});

const keepsStructuredOutput = Effect.gen(function* () {
  const { runPromise, setup } = yield* keepsStructuredOutputStep1;
  let plain: durableTypes.NestedToolExecutionResult | undefined;
  let counter: durableTypes.NestedToolExecutionResult | undefined;
  let other: durableTypes.NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    defineTool({
      description: "probe",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            plain = yield* awaited(api.executeTool("plain", {}, callContext));
            counter = yield* awaited(api.executeTool("counter", {}, callContext));
            other = yield* awaited(api.executeTool("other", {}, callContext));
            return {};
          }),
        ),
      name: "probe",
      parameters: Type.Object({}),
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  yield* awaited(harness.close(context));
  expect(plain?.structuredOutput).toBe("rewritten");
  expect(counter).toMatchObject({ structuredOutput: { count: 1 } });
  expect(other?.isError).toBe(true);
  expect(codes(other!)).toEqual(["invalid_structured_output"]);
});

describe("structured output", () => {
  it("keeps structured output when afterTool replaces the output, and validates one afterTool replaces", () =>
    Effect.runPromise(keepsStructuredOutput));
});
