import { Type } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import { defineTool, type NestedToolExecutionResult } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  direct,
  DONE,
  call,
  Count,
  returning,
  codes,
  nested,
} from "./harness-structured-output-support.ts";
import { chatSetup, openChat, awaited, addHooks, addTool, context } from "./support.ts";

const expectErrorTextAsDiagnostic = Effect.fn("expectErrorTextAsDiagnostic")(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    returning(
      "fails",
      { output: [{ type: "text", text: "nope" }], isError: true },
      { structuredOutputSchema: Count },
    ),
  );
  const received = yield* nested(setup, "fails");
  expect(received).toMatchObject({
    isError: true,
    diagnostics: [{ severity: "error", code: "tool_error", message: "nope" }],
  });
  expect(received).not.toHaveProperty("structuredOutput");
});

const expectModelKeepsErrorText = Effect.fn("expectModelKeepsErrorText")(function* () {
  const modelSetup = chatSetup();
  addTool(
    modelSetup.registry,
    returning(
      "fails",
      { output: [{ type: "text", text: "nope" }], isError: true },
      { structuredOutputSchema: Count },
    ),
  );
  const stored = yield* direct(modelSetup, "fails");
  expect(stored.content).toEqual([{ type: "text", text: "nope" }]);
});

const expectThrownErrorDiagnostic = Effect.fn("expectThrownErrorDiagnostic")(function* () {
  const thrown = chatSetup();
  addTool(
    thrown.registry,
    defineTool({
      name: "throws",
      description: "throws",
      parameters: Type.Object({}),
      structuredOutputSchema: Count,
      execute: () => Promise.reject(new Error("permission denied")),
    }),
  );
  const thrownResult = yield* nested(thrown, "throws");
  expect(thrownResult).toMatchObject({
    isError: true,
    diagnostics: [{ code: "tool_error", message: "permission denied" }],
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
        output: [{ type: "text", text: "partial log" }],
        isError: true,
        diagnostics: [{ severity: "error", code: "quota", message: "quota exceeded" }],
      },
      { structuredOutputSchema: Count },
    ),
  );
  expect((yield* nested(explained, "fails")).diagnostics).toEqual([
    { severity: "error", code: "quota", message: "quota exceeded" },
  ]);
});

const expectErrorKeepsStructuredOutput = Effect.fn("expectErrorKeepsStructuredOutput")(
  function* () {
    const kept = chatSetup();
    const withValue = {
      output: [{ type: "text" as const, text: "nope" }],
      structuredOutput: { count: 0 },
      isError: true,
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
    returning("bad", { output: [{ type: "text", text: "bad" }], isError: true }),
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
    isError: true,
    diagnostics: [{ code: "tool_unavailable" }],
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

const keepsStructuredOutput = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, returning("plain", { output: [{ type: "text", text: "secret" }] }));
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
        ? { ...result, structuredOutput: { count: "broken" } as unknown as JsonValue }
        : hookCall.name === "probe"
          ? result
          : { ...result, output: [{ type: "text", text: "rewritten" }] },
  });
  let plain: NestedToolExecutionResult | undefined;
  let counter: NestedToolExecutionResult | undefined;
  let other: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    defineTool({
      name: "probe",
      description: "probe",
      parameters: Type.Object({}),
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            plain = yield* awaited(api.executeTool("plain", {}, callContext));
            counter = yield* awaited(api.executeTool("counter", {}, callContext));
            other = yield* awaited(api.executeTool("other", {}, callContext));
            return {};
          }),
        ),
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
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
