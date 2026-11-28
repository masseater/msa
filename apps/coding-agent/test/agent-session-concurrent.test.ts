import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import sessionKit from "./session-kit.ts";
import sessionWorkspace from "./session-workspace.ts";

const workspace = sessionWorkspace.useWorkspace("msa-concurrent-test-");

const { awaited, runTest } = testing;
const { createAgentSession, replyWhenAborted, streamWith, waitForStreaming } = sessionKit;

const startAbortableSession = Effect.gen(function* () {
  const created = yield* createAgentSession({
    cwd: workspace.tempDir,
    streamFn: streamWith(({ signal, stream }) => replyWhenAborted(stream, signal)),
  });
  workspace.session = created.session;
  const firstPrompt = created.session.run.prompting.prompt("First message");
  yield* waitForStreaming(created.session);
  return { firstPrompt, session: created.session };
});

const stopStreaming = (running: {
  session: agentSessionTypes.AgentSession;
  firstPrompt: Promise<void>;
}) =>
  Effect.gen(function* () {
    yield* awaited(running.session.run.lifecycle.abort());
    yield* awaited(running.firstPrompt.catch(() => {}));
  });

const shouldThrowWhenPromptCalledWhileStreaming = () =>
  runTest(
    Effect.gen(function* () {
      const running = yield* startAbortableSession;
      expect(running.session.isStreaming).toBe(true);
      yield* awaited(
        expect(running.session.run.prompting.prompt("Second message")).rejects.toThrow(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        ),
      );
      yield* stopStreaming(running);
    }),
  );

const shouldAllowSteerWhileStreaming = () =>
  runTest(
    Effect.gen(function* () {
      const running = yield* startAbortableSession;
      yield* awaited(
        expect(running.session.run.queue.steer("Steering message")).resolves.toBe("queued"),
      );
      expect(running.session.run.queue.pendingMessageCount).toBe(1);
      yield* stopStreaming(running);
    }),
  );

const shouldAllowFollowupWhileStreaming = () =>
  runTest(
    Effect.gen(function* () {
      const running = yield* startAbortableSession;
      yield* awaited(
        expect(running.session.run.queue.followUp("Follow-up message")).resolves.toBe("queued"),
      );
      expect(running.session.run.queue.pendingMessageCount).toBe(1);
      yield* stopStreaming(running);
    }),
  );

describe("AgentSession concurrent prompt guard", () => {
  it(
    "should throw when prompt() called while streaming",
    shouldThrowWhenPromptCalledWhileStreaming,
  );

  it("should allow steer() while streaming", shouldAllowSteerWhileStreaming);

  it("should allow followUp() while streaming", shouldAllowFollowupWhileStreaming);
});
