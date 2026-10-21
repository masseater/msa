import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import agentSessionConcurrentSupport from "./agent-session-concurrent-support.ts";
import sessionKit from "./session-kit.ts";

const { awaited, runTest } = testing;
const {
  assistantMessage,
  createAgentSession,
  disposeWorkspace,
  prepareWorkspace,
  reply,
  replyWhenAborted,
  streamWith,
  userTexts,
  waitForStreaming,
} = sessionKit;
const { dummyCall, dummyTool, installExtensionRunner, toolCallResponder } =
  agentSessionConcurrentSupport;

let tempDir = "";

let session: agentSessionTypes.AgentSession | undefined;

const steeringSession = (seen: {
  steered: boolean;
  source: string | undefined;
  api?: extensionsTypesTypes.ExtensionAPI;
}) =>
  createAgentSession({
    cwd: tempDir,
    extensionFactories: [
      (msa) => {
        seen.api = msa;
        msa.on("input", (event) =>
          runTest(
            Effect.sync(() => {
              seen.source = event.source;
            }),
          ),
        );
      },
    ],
    streamFn: streamWith(({ context, signal, stream }) => {
      if (!userTexts(context.messages).includes("Steer from extension")) {
        replyWhenAborted(stream, signal);
        return;
      }
      seen.steered = true;
      reply(stream, assistantMessage("Steered"));
    }),
  });

const shouldQueueExtensionOriginSteeringMessagesWhile = () =>
  runTest(
    Effect.gen(function* () {
      const seen: {
        steered: boolean;
        source: string | undefined;
        api?: extensionsTypesTypes.ExtensionAPI;
      } = {
        source: undefined,
        steered: false,
      };
      const created = yield* steeringSession(seen);
      ({ session } = created);
      const queueEvents: Array<{ steering: readonly string[] }> = [];
      created.session.subscribe((event) => {
        if (event.type === "queue_update") queueEvents.push({ steering: event.steering });
      });
      const firstPrompt = created.session.run.prompting.prompt("First message");
      yield* waitForStreaming(created.session);

      seen.api?.sendUserMessage("Steer from extension", { deliverAs: "steer" });
      yield* Effect.sleep(25);

      expect(created.session.run.queue.pendingMessageCount).toBe(1);
      expect(created.session.run.queue.getSteeringMessages()).toContain("Steer from extension");
      expect(seen.source).toBe("extension");
      expect(queueEvents.some((event) => event.steering.includes("Steer from extension"))).toBe(
        true,
      );

      yield* awaited(created.session.run.lifecycle.abort());
      yield* awaited(firstPrompt.catch(() => {}));
      expect(seen.steered).toBe(true);
    }),
  );

const shouldAllowPromptAfterPreviousCompletes = () =>
  runTest(
    Effect.gen(function* () {
      const created = yield* createAgentSession({
        cwd: tempDir,
        streamFn: streamWith(({ stream }) => reply(stream, assistantMessage("Done"))),
      });
      ({ session } = created);
      yield* awaited(created.session.run.prompting.prompt("First message"));
      expect(created.session.isStreaming).toBe(false);
      yield* awaited(
        expect(created.session.run.prompting.prompt("Second message")).resolves.not.toThrow(),
      );
    }),
  );

const shouldWaitForQueuedAgentEventsBefore = () =>
  runTest(
    Effect.gen(function* () {
      const created = yield* createAgentSession({
        cwd: tempDir,
        streamFn: streamWith(
          toolCallResponder([dummyCall("toolu_1", "x"), dummyCall("toolu_2", "y")]),
        ),
        tools: [dummyTool],
      });
      ({ session } = created);
      const snapshots: string[][] = [];
      installExtensionRunner(created.session, {
        emitToolCall: () =>
          runTest(
            Effect.sync(() => {
              snapshots.push(
                created.sessionManager
                  .getEntries()
                  .filter((entry) => entry.type === "message")
                  .map((entry) => entry.message.role),
              );
              return undefined;
            }),
          ),
      });
      yield* awaited(created.session.run.prompting.prompt("hi"));
      yield* awaited(created.session.agent.waitForIdle());
      expect(snapshots).toEqual([
        ["system", "user", "assistant"],
        ["system", "user", "assistant"],
      ]);
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
    "should queue extension-origin steering messages while streaming",
    shouldQueueExtensionOriginSteeringMessagesWhile,
  );

  it("should allow prompt() after previous completes", shouldAllowPromptAfterPreviousCompletes);

  it(
    "should wait for queued agent events before emitting tool_call",
    shouldWaitForQueuedAgentEventsBefore,
  );
});
