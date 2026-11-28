import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import agentSessionConcurrentSupport from "./agent-session-concurrent-support.ts";
import sessionKit from "./session-kit.ts";
import sessionWorkspace from "./session-workspace.ts";

const workspace = sessionWorkspace.useWorkspace("msa-concurrent-test-");

const { awaited, runTest } = testing;
const { assistantMessage, createAgentSession, streamWith } = sessionKit;
const { dummyCall, dummyTool, installExtensionRunner, toolCallResponder } =
  agentSessionConcurrentSupport;

const shouldPersistMessageEndEventsInOrder = () =>
  runTest(
    Effect.gen(function* () {
      const created = yield* createAgentSession({
        cwd: workspace.tempDir,
        streamFn: streamWith(
          toolCallResponder([
            ...assistantMessage("calling tool").content,
            dummyCall("toolu_1", "x"),
          ]),
        ),
        tools: [dummyTool],
      });
      workspace.session = created.session;
      installExtensionRunner(created.session, {
        emitMessageEnd: (event) =>
          runTest(
            Effect.as(
              event.type === "message_end" && event.message?.role === "assistant"
                ? Effect.sleep(40)
                : Effect.void,
              undefined,
            ),
          ),
      });
      yield* awaited(created.session.run.prompting.prompt("hi"));
      yield* awaited(created.session.agent.waitForIdle());
      yield* Effect.sleep(100);
      expect(
        created.sessionManager
          .getEntries()
          .filter((entry) => entry.type === "message")
          .map((entry) => entry.message.role),
      ).toEqual(["system", "user", "assistant", "toolResult", "system", "assistant"]);
    }),
  );

describe("AgentSession concurrent prompt guard", () => {
  it(
    "should persist message_end events in order with slow extension handlers",
    shouldPersistMessageEndEventsInOrder,
  );
});
