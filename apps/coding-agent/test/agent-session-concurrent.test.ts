import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { AgentSession } from "../src/core/agent-session.ts";
import sessionKit from "./session-kit.ts";

const { awaited, runTest } = testing;
const {
  createAgentSession,
  disposeWorkspace,
  prepareWorkspace,
  replyWhenAborted,
  streamWith,
  waitForStreaming,
} = sessionKit;

let tempDir = "";

let session: AgentSession | undefined;

const startAbortableSession = Effect.gen(function* () {
  const created = yield* createAgentSession({
    cwd: tempDir,
    streamFn: streamWith(({ signal, stream }) => replyWhenAborted(stream, signal)),
  });
  ({ session } = created);
  const firstPrompt = created.session.prompt("First message");
  yield* waitForStreaming(created.session);
  return { firstPrompt, session: created.session };
});

const stopStreaming = (running: { session: AgentSession; firstPrompt: Promise<void> }) =>
  Effect.gen(function* () {
    yield* awaited(running.session.abort());
    yield* awaited(running.firstPrompt.catch(() => {}));
  });

const shouldThrowWhenPromptCalledWhileStreaming = () =>
  runTest(
    Effect.gen(function* () {
      const running = yield* startAbortableSession;
      expect(running.session.isStreaming).toBe(true);
      yield* awaited(
        expect(running.session.prompt("Second message")).rejects.toThrow(
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
      yield* awaited(expect(running.session.steer("Steering message")).resolves.toBe("queued"));
      expect(running.session.pendingMessageCount).toBe(1);
      yield* stopStreaming(running);
    }),
  );

const shouldAllowFollowupWhileStreaming = () =>
  runTest(
    Effect.gen(function* () {
      const running = yield* startAbortableSession;
      yield* awaited(expect(running.session.followUp("Follow-up message")).resolves.toBe("queued"));
      expect(running.session.pendingMessageCount).toBe(1);
      yield* stopStreaming(running);
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
    "should throw when prompt() called while streaming",
    shouldThrowWhenPromptCalledWhileStreaming,
  );

  it("should allow steer() while streaming", shouldAllowSteerWhileStreaming);

  it("should allow followUp() while streaming", shouldAllowFollowupWhileStreaming);
});
