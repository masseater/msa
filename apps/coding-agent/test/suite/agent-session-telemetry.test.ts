import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { InMemoryTelemetryContext, type RecordedTelemetrySpan } from "@msa/telemetry";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, type Harness } from "./harness.ts";

const echoTool: AgentTool = {
  name: "echo",
  label: "Echo",
  description: "Echo text",
  parameters: Type.Object({ text: Type.String() }),
  execute: async (_id, params) => ({
    content: [{ type: "text", text: (params as { text: string }).text }],
    details: {},
  }),
};

const brokenTool: AgentTool = {
  name: "broken",
  label: "Broken",
  description: "Always fails",
  parameters: Type.Object({}),
  execute: async () => {
    throw new Error("disk is full");
  },
};

function named(spans: readonly RecordedTelemetrySpan[], name: string): RecordedTelemetrySpan[] {
  return spans.filter((span) => span.name === name);
}

describe("AgentSession telemetry", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("nests LLM requests and tool calls under each turn and counts tokens and tool failures", async () => {
    const telemetry = new InMemoryTelemetryContext();
    const harness = await createHarness({
      tools: [echoTool, brokenTool],
      telemetry: { context: telemetry, role: "worker" },
    });
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "hi" }), fauxToolCall("broken", {})], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);

    await harness.session.prompt("go");

    const spans = telemetry.getSpans();
    const turns = named(spans, "msa.turn");
    const requests = named(spans, "msa.llm.request");
    const tools = named(spans, "msa.tool.call");
    expect(turns).toHaveLength(2);
    expect(requests.map((span) => span.parentId)).toEqual(turns.map((turn) => turn.id));
    expect(requests[0]?.attributes).toMatchObject({
      "gen_ai.request.model": harness.getModel().id,
      "gen_ai.provider.name": harness.getModel().provider,
      "msa.stop_reason": "toolUse",
    });
    expect(requests[0]?.attributes["gen_ai.usage.input_tokens"]).toBeGreaterThan(0);
    expect(turns[0]?.attributes).toMatchObject({ "msa.session.role": "worker" });
    expect(
      tools.map((span) => [span.parentId, span.attributes["gen_ai.tool.name"], span.status]),
    ).toEqual([
      [turns[0]?.id, "echo", { status: "ok" }],
      [
        turns[0]?.id,
        "broken",
        { status: "error", error: { name: "ToolError", message: "disk is full" } },
      ],
    ]);
    expect(spans.every((span) => span.settled)).toBe(true);

    const metrics = telemetry.getMetrics();
    expect(
      metrics
        .filter((metric) => metric.name === "msa.tool.calls")
        .map((metric) => [metric.attributes["gen_ai.tool.name"], metric.attributes["msa.outcome"]]),
    ).toEqual([
      ["echo", "ok"],
      ["broken", "error"],
    ]);
    expect(
      metrics.some(
        (metric) =>
          metric.name === "msa.llm.tokens" &&
          metric.attributes["msa.token.type"] === "input" &&
          metric.value > 0,
      ),
    ).toBe(true);
    expect(
      metrics.filter((metric) => metric.name === "msa.llm.request.duration").map((m) => m.unit),
    ).toEqual(["s", "s"]);

    const failure = telemetry.getLogs().find((log) => log.body === "msa.tool.failed");
    expect(failure).toEqual({
      spanId: tools[1]?.id,
      severity: "warn",
      body: "msa.tool.failed",
      attributes: { "gen_ai.tool.name": "broken", "error.message": "disk is full" },
    });
  });

  it("ends the open turn when the session is disposed mid-turn", async () => {
    const telemetry = new InMemoryTelemetryContext();
    const harness = await createHarness({ telemetry: { context: telemetry, role: "main" } });
    harnesses.push(harness);
    harness.setResponses([fauxAssistantMessage("partial")]);
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "turn_start") harness.session.dispose();
    });

    await harness.session.prompt("go").catch(() => undefined);
    unsubscribe();

    const turns = named(telemetry.getSpans(), "msa.turn");
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((turn) => turn.settled)).toBe(true);
  });
});
