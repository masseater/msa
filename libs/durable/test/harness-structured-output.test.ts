import { Type } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import {
  defineTool,
  MemoryStorage,
  NestedCallDoc,
  type NestedCallState,
  type NestedToolExecutionResult,
  type ToolExecutionResult,
  watchEvents,
} from "@msa/durable";
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
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

async function probingStructuredTools() {
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
      execute: async (_args, api, callContext) => {
        received.push(await api.executeTool("plain", {}, callContext));
        received.push(await api.executeTool("nothing", {}, callContext));
        return {};
      },
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const storage = new MemoryStorage();
  const { harness, root } = await openChat(storage, setup);
  return { received, harness, root };
}

describe("structured output", () => {
  it("gives callers a schema-less tool's output: one text as a string, one image as itself, else the list", async () => {
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
    for await (const [output, value] of cases) {
      const setup = chatSetup();
      addTool(setup.registry, returning("plain", { output }));
      const received = await nested(setup, "plain");
      expect(received).toEqual({
        taskId: received.taskId,
        structuredOutput: value,
        isError: false,
        diagnostics: [],
        durationMs: received.durationMs,
      });
    }
  });

  it("gives callers the bounded output, as the model sees it, without the rendered diagnostics", async () => {
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
    const received = await nested(setup, "long");
    expect(received.structuredOutput).toBe("a\n");
    expect(codes(received)).toEqual([undefined, "truncated"]);
  });
});

describe("structured output", () => {
  it("stores exactly what callers and events get, without the model's output, and keeps a stored null", async () => {
    const { received, harness, root } = await probingStructuredTools();
    // The result each nested call's document got, as committed.
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
    const stream = await watchEvents(harness, root.id, context);
    const ends: NestedToolExecutionResult[] = [];
    stream.start((batch) => {
      for (const event of batch) {
        if (event.type === "tool_execution_end" && event.parentToolCallId !== undefined) {
          ends.push(event.result as NestedToolExecutionResult);
        }
      }

      return Promise.resolve();
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    await harness.waitForIdle(context);
    await stream.stop();
    await harness.close(context);

    expect(received[0]).toMatchObject({ structuredOutput: "a", isError: false });
    expect(received[1]).toMatchObject({ structuredOutput: null, isError: false });
    expect(received[0]).not.toHaveProperty("output");
    expect(stored).toEqual(received);
    expect(ends).toEqual(received);
  });
});

describe("structured output", () => {
  it("gives callers a schema tool's validated structured output, which the transcript does not store", async () => {
    const setup = chatSetup();
    const result = {
      output: [{ type: "text" as const, text: "3 things" }],
      structuredOutput: { count: 3 },
    };
    addTool(setup.registry, returning("counter", result, { structuredOutputSchema: Count }));
    expect(await nested(setup, "counter")).toMatchObject({
      structuredOutput: { count: 3 },
      isError: false,
    });

    const modelSetup = chatSetup();
    addTool(modelSetup.registry, returning("counter", result, { structuredOutputSchema: Count }));
    const stored = await direct(modelSetup, "counter");
    expect(stored).toMatchObject({ isError: false, content: [{ type: "text", text: "3 things" }] });
    expect(stored).not.toHaveProperty("structuredOutput");
  });
});

describe("structured output", () => {
  it("turns structured output that breaks the schema into an error result for callers, and a report for the model's calls", async () => {
    const cases: [name: string, result: ToolExecutionResult, schema: boolean, message: string][] = [
      [
        "wrong",
        { structuredOutput: { count: "three" } },
        true,
        "does not match its schema: count:",
      ],
      ["missing", { output: [] }, true, "returned no structuredOutput"],
      [
        "undeclared",
        { structuredOutput: { count: 3 } },
        false,
        "declares no structuredOutputSchema",
      ],
    ];
    for await (const [name, result, schema, message] of cases) {
      const setup = chatSetup();
      addTool(
        setup.registry,
        returning(name, result, schema ? { structuredOutputSchema: Count } : {}),
      );
      const received = await nested(setup, name);
      expect(received.isError).toBe(true);
      // The broken value is dropped; a schema-less tool's error result still carries its output, here none.
      if (schema) expect(received).not.toHaveProperty("structuredOutput");
      else expect(received.structuredOutput).toBe("");
      expect(codes(received)).toEqual(["invalid_structured_output"]);
      expect(received.diagnostics[0]?.message).toContain(message);

      const modelSetup = chatSetup();
      addTool(
        modelSetup.registry,
        returning(name, result, schema ? { structuredOutputSchema: Count } : {}),
      );
      // The model never sees structured output: its call stands, and the host gets a report.
      const stored = await direct(modelSetup, name);
      expect(stored.isError).toBe(false);
      expect(JSON.stringify(stored.content)).not.toContain(message);
      expect(modelSetup.reports.map((error) => (error as Error).message).join("\n")).toContain(
        message,
      );
    }
  });
});
