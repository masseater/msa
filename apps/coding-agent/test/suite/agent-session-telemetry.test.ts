import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import telemetryModule from "@msa/telemetry";
import type telemetryTypes from "@msa/telemetry/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { InMemoryTelemetryContext } = telemetryModule;

const { awaited, runTest } = testing;

const { createHarness } = harnessModule;

const echoTool: agentTypes.AgentTool = {
  description: "Echo text",
  execute: (_id, params) =>
    runTest(
      Effect.sync(() => ({
        content: [{ text: (params as { text: string }).text, type: "text" }],
        details: {},
      })),
    ),
  label: "Echo",
  name: "echo",
  parameters: Type.Object({ text: Type.String() }),
};

const brokenTool: agentTypes.AgentTool = {
  description: "Always fails",
  execute: () =>
    runTest(
      Effect.sync(() => {
        throw new Error("disk is full");
      }),
    ),
  label: "Broken",
  name: "broken",
  parameters: Type.Object({}),
};

function named(
  spans: readonly telemetryTypes.RecordedTelemetrySpan[],
  name: string,
): telemetryTypes.RecordedTelemetrySpan[] {
  return spans.filter((span) => span.name === name);
}

const harnesses: harnessTypes.Harness[] = [];

const runToolTurnWithTelemetry = Effect.gen(function* () {
  const telemetry = new InMemoryTelemetryContext();
  const harness = yield* awaited(
    createHarness({
      telemetry: { context: telemetry, role: "worker" },
      tools: [echoTool, brokenTool],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hi" }), fauxToolCall("broken", {})], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* awaited(harness.session.run.prompting.prompt("go"));

  const spans = telemetry.getSpans();
  const turns = named(spans, "msa.turn");
  const requests = named(spans, "msa.llm.request");
  const tools = named(spans, "msa.tool.call");
  expect(turns).toHaveLength(2);
  expect(requests.map((span) => span.parentId)).toEqual(turns.map((turn) => turn.id));
  expect(requests[0]?.attributes).toMatchObject({
    "gen_ai.provider.name": harness.getModel().provider,
    "gen_ai.request.model": harness.getModel().id,
    "msa.stop_reason": "toolUse",
  });
  return { requests, spans, telemetry, tools, turns };
});

const nestsLlmRequestsAndToolCallsUnder = Effect.gen(function* () {
  const { requests, spans, telemetry, tools, turns } = yield* awaited(
    runTest(runToolTurnWithTelemetry),
  );
  expect(requests[0]?.attributes["gen_ai.usage.input_tokens"]).toBeGreaterThan(0);
  expect(turns[0]?.attributes).toMatchObject({ "msa.session.role": "worker" });
  expect(
    tools.map((span) => [span.parentId, span.attributes["gen_ai.tool.name"], span.status]),
  ).toEqual([
    [turns[0]?.id, "echo", { status: "ok" }],
    [
      turns[0]?.id,
      "broken",
      { error: { message: "disk is full", name: "ToolError" }, status: "error" },
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
    attributes: { "error.message": "disk is full", "gen_ai.tool.name": "broken" },
    body: "msa.tool.failed",
    severity: "warn",
    spanId: tools[1]?.id,
  });
});

const endsTheOpenTurnWhenTheSession = Effect.gen(function* () {
  const telemetry = new InMemoryTelemetryContext();
  const harness = yield* awaited(
    createHarness({ telemetry: { context: telemetry, role: "main" } }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("partial")]);
  const unsubscribe = harness.session.subscribe((event) => {
    if (event.type === "turn_start") harness.session.dispose();
  });

  yield* awaited(harness.session.run.prompting.prompt("go").catch(() => undefined));
  unsubscribe();

  const turns = named(telemetry.getSpans(), "msa.turn");
  expect(turns.length).toBeGreaterThan(0);
  expect(turns.every((turn) => turn.settled)).toBe(true);
});

describe("AgentSession telemetry", () => {
  afterEach(() => cleanupAll(harnesses));

  it("nests LLM requests and tool calls under each turn and counts tokens and tool failures", () =>
    runTest(nestsLlmRequestsAndToolCallsUnder));

  it("ends the open turn when the session is disposed mid-turn", () =>
    runTest(endsTheOpenTurnWhenTheSession));
});
