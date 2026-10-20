import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { AgentSession } from "../src/core/agent-session.ts";
import agentSessionConcurrentSupport from "./agent-session-concurrent-support.ts";
import sessionKit from "./session-kit.ts";

const { awaited, runTest } = testing;
const { assistantMessage, createAgentSession, disposeWorkspace, prepareWorkspace, streamWith } =
  sessionKit;
const { dummyCall, dummyTool, installExtensionRunner, toolCallResponder } =
  agentSessionConcurrentSupport;

let tempDir = "";

let session: AgentSession | undefined;

const shouldPersistMessageEndEventsInOrder = () =>
  runTest(
    Effect.gen(function* () {
      const created = yield* createAgentSession({
        cwd: tempDir,
        streamFn: streamWith(
          toolCallResponder([
            ...assistantMessage("calling tool").content,
            dummyCall("toolu_1", "x"),
          ]),
        ),
        tools: [dummyTool],
      });
      ({ session } = created);
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
      yield* awaited(created.session.prompt("hi"));
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

const prepare = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* prepareWorkspace("msa-concurrent-test-");
    }),
  );

const cleanUp = () =>
  runTest(
    Effect.gen(function* () {
      yield* disposeWorkspace(session, tempDir);
      session = undefined;
    }),
  );

describe("AgentSession concurrent prompt guard", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should persist message_end events in order with slow extension handlers",
    shouldPersistMessageEndEventsInOrder,
  );
});
