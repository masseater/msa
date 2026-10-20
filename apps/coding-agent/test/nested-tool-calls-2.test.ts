import type agentTypes from "@msa/agent-core/index.types";
import { describe, expect, it } from "vite-plus/test";

import { NESTED_CALL_LIMITS, NestedCallRecorder } from "../src/core/nested-tool-calls.ts";

const call2 = (
  id: string,
  args: agentTypes.AgentToolCall["arguments"],
): agentTypes.AgentToolCall => ({
  arguments: args,
  id,
  name: "t",
  type: "toolCall" as const,
});

const omitsOversizedArgumentsAndDropsCallsBeyond = () => {
  const recorder = new NestedCallRecorder();
  expect(recorder.snapshot()).toBeUndefined();
  const small = recorder.start(call2("a", { x: 1 }));
  recorder.finish(small, false, "");
  expect(recorder.snapshot()).toEqual({
    calls: [
      { arguments: { x: 1 }, durationMs: expect.any(Number), id: "a", name: "t", status: "ok" },
    ],
    complete: true,
  });

  const big = recorder.start(
    call2("b", { text: "x".repeat(NESTED_CALL_LIMITS.maxArgumentBytesPerCall) }),
  );
  recorder.finish(big, true, "e".repeat(1000));
  const snapshot = recorder.snapshot();
  expect(snapshot?.complete).toBe(false);
  expect(snapshot?.calls[1]).toMatchObject({ id: "b", status: "error" });
  expect(snapshot?.calls[1]?.arguments).toBeUndefined();
  expect(snapshot?.calls[1]?.argumentsBytes).toBeGreaterThan(
    NESTED_CALL_LIMITS.maxArgumentBytesPerCall,
  );
  expect(snapshot?.calls[1]?.error).toHaveLength(NESTED_CALL_LIMITS.maxErrorChars);

  for (let i = 0; i < NESTED_CALL_LIMITS.maxCalls; i++)
    recorder.finish(recorder.start(call2(`c${i}`, {})), false, "");
  expect(recorder.snapshot()?.calls).toHaveLength(NESTED_CALL_LIMITS.maxCalls);
};

const capsTheTotalArgumentSizeAndMarks = () => {
  const recorder = new NestedCallRecorder();
  const chunk = { text: "x".repeat(7000) };
  const records = Array.from({ length: 6 }, (_, i) => recorder.start(call2(`c${i}`, chunk)));
  const snapshot = recorder.snapshot();

  expect(snapshot?.calls.filter((entry) => entry.arguments !== undefined)).toHaveLength(4);
  expect(snapshot?.calls.every((entry) => entry.status === "unfinished")).toBe(true);
  expect(snapshot?.complete).toBe(false);
  expect(records).toHaveLength(6);
};

describe("NestedCallRecorder", () => {
  it(
    "omits oversized arguments and drops calls beyond the limit",
    omitsOversizedArgumentsAndDropsCallsBeyond,
  );

  it(
    "caps the total argument size and marks unfinished calls incomplete",
    capsTheTotalArgumentSizeAndMarks,
  );
});
