import { Type } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import { defineTool, MemoryStorage, type NestedToolExecutionResult, ToolTask } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import {
  direct,
  DONE,
  call,
  Count,
  returning,
  codes,
  nested,
} from "./harness-structured-output-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

async function expectErrorTextAsDiagnostic() {
  const setup = chatSetup();
  addTool(
    setup.registry,
    returning(
      "fails",
      { output: [{ type: "text", text: "nope" }], isError: true },
      { structuredOutputSchema: Count },
    ),
  );
  // Its text reaches the caller as an error diagnostic: structuredOutput is only ever the tool's own value.
  const received = await nested(setup, "fails");
  expect(received).toMatchObject({
    isError: true,
    diagnostics: [{ severity: "error", code: "tool_error", message: "nope" }],
  });
  expect(received).not.toHaveProperty("structuredOutput");
}

async function expectModelKeepsErrorText() {
  // The model's call keeps the text in its output, without the extra diagnostic.
  const modelSetup = chatSetup();
  addTool(
    modelSetup.registry,
    returning(
      "fails",
      { output: [{ type: "text", text: "nope" }], isError: true },
      { structuredOutputSchema: Count },
    ),
  );
  const stored = await direct(modelSetup, "fails");
  expect(stored.content).toEqual([{ type: "text", text: "nope" }]);
}

async function expectThrownErrorDiagnostic() {
  // A thrown error's message is in its tool_error diagnostic, not in the output.
  const thrown = chatSetup();
  addTool(
    thrown.registry,
    defineTool({
      name: "throws",
      description: "throws",
      parameters: Type.Object({}),
      structuredOutputSchema: Count,
      execute: () => {
        return Promise.reject(new Error("permission denied"));
      },
    }),
  );
  const thrownResult = await nested(thrown, "throws");
  // One diagnostic: the thrown message, not a second one from its (empty) output.
  expect(thrownResult).toMatchObject({
    isError: true,
    diagnostics: [{ code: "tool_error", message: "permission denied" }],
  });
  expect(thrownResult.diagnostics).toHaveLength(1);
  expect(thrownResult).not.toHaveProperty("structuredOutput");
}

async function expectOwnDiagnosticsOnly() {
  // An error result whose own diagnostics say what went wrong gets no second one from its output.
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
  expect((await nested(explained, "fails")).diagnostics).toEqual([
    { severity: "error", code: "quota", message: "quota exceeded" },
  ]);
}

async function expectErrorKeepsStructuredOutput() {
  // An error result that has structured output keeps it.
  const kept = chatSetup();
  const withValue = {
    output: [{ type: "text" as const, text: "nope" }],
    structuredOutput: { count: 0 },
    isError: true,
  };
  addTool(kept.registry, returning("fails", withValue, { structuredOutputSchema: Count }));
  expect(await nested(kept, "fails")).toMatchObject({
    isError: true,
    structuredOutput: { count: 0 },
  });
}

describe("structured output", () => {
  it("gives callers the output of an error result of a tool without a schema", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      returning("bad", { output: [{ type: "text", text: "bad" }], isError: true }),
    );
    expect(await nested(setup, "bad")).toMatchObject({ isError: true, structuredOutput: "bad" });
  });

  it("gives callers no structured output for an error result the Harness wrote, only diagnostics", async () => {
    const setup = chatSetup();
    const received = await nested(setup, "missing");
    expect(received).toMatchObject({ isError: true, diagnostics: [{ code: "tool_unavailable" }] });
    expect(received).not.toHaveProperty("structuredOutput");
  });

  it("gives callers a schema tool's error text as a diagnostic, never as structured output", async () => {
    await expectErrorTextAsDiagnostic();
    await expectModelKeepsErrorText();
    await expectThrownErrorDiagnostic();
    await expectOwnDiagnosticsOnly();
    await expectErrorKeepsStructuredOutput();
  });
});

describe("structured output", () => {
  it("keeps structured output when afterTool replaces the output, and validates one afterTool replaces", async () => {
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
        execute: async (_args, api, callContext) => {
          plain = await api.executeTool("plain", {}, callContext);
          counter = await api.executeTool("counter", {}, callContext);
          other = await api.executeTool("other", {}, callContext);
          return {};
        },
      }),
    );
    setup.faux.setResponses([call("probe"), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    await harness.close(context);
    // A schema-less tool's value is its output, so redacting the output redacts what programs get.
    expect(plain?.structuredOutput).toBe("rewritten");
    expect(counter).toMatchObject({ structuredOutput: { count: 1 } });
    expect(other?.isError).toBe(true);
    expect(codes(other!)).toEqual(["invalid_structured_output"]);
  });
});
