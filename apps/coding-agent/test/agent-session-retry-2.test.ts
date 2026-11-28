import type agentTypes from "@msa/agent-core/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import agentSessionRetrySupport from "./agent-session-retry-support.ts";
import sessionKit from "./session-kit.ts";
import sessionWorkspace from "./session-workspace.ts";

const workspace = sessionWorkspace.useWorkspace("msa-retry-test-");

const { awaited, runTest } = testing;
const { assistantMessage } = sessionKit;
const { createRetrySession, errorMessage, scriptedStream } = agentSessionRetrySupport;

const echoTool = (executed: { value: boolean }): agentTypes.AgentTool => ({
  description: "Echo text back",
  execute: () =>
    runTest(
      Effect.sync(() => {
        executed.value = true;
        return { content: [{ text: "echoed", type: "text" as const }], details: undefined };
      }),
    ),
  label: "Echo",
  name: "echo",
  parameters: Type.Object({ text: Type.String() }),
});

const toolCallReply = assistantMessage("Looking that up now.", {
  content: [
    { text: "Looking that up now.", type: "text" },
    { arguments: { text: "hello" }, id: "call_1", name: "echo", type: "toolCall" },
  ],
  stopReason: "toolUse",
});

const promptWaitsForFullAgentLoopWhen = () =>
  runTest(
    Effect.gen(function* () {
      const executed = { value: false };
      const stream = scriptedStream((call) => {
        if (call === 1) return errorMessage("overloaded_error");
        return call === 2 ? toolCallReply : assistantMessage("Final answer.");
      });
      workspace.session = yield* createRetrySession({
        cwd: workspace.tempDir,
        retry: { maxRetries: 3 },
        streamFn: stream.streamFn,
        tools: [echoTool(executed)],
      });
      yield* awaited(workspace.session.run.prompting.prompt("Test"));
      expect(stream.callCount()).toBe(3);
      expect(executed.value).toBe(true);
      expect(workspace.session.isStreaming).toBe(false);
      yield* awaited(workspace.session.run.prompting.prompt("Follow-up"));
      expect(stream.callCount()).toBe(4);
    }),
  );

describe("AgentSession retry", () => {
  it(
    "prompt waits for full agent loop when retry produces tool calls",
    promptWaitsForFullAgentLoopWhen,
  );
});
