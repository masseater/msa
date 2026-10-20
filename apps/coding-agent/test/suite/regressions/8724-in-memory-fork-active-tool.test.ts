import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import AgentSessionRuntime from "../../../src/core/agent-session-runtime.ts";
import type agentSessionRuntimeTypes from "../../../src/core/agent-session-runtime.types.ts";
import agentSessionServices from "../../../src/core/agent-session-services.ts";
import harnessModule from "../harness.ts";

const { createAgentSessionFromServices } = agentSessionServices;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;

const { deferredPromise, gate, runTest } = testing;

const cleanups: Array<() => Promise<void> | void> = [];

const blockingTool = (toolStarted: ReturnType<typeof gate>): agentTypes.AgentTool => ({
  description: "Wait until aborted",
  execute: (_toolCallId, _params, signal) => {
    const aborted = deferredPromise<agentTypes.AgentToolResult<unknown>>();
    toolStarted.release();
    signal?.addEventListener(
      "abort",
      () => aborted.resolve({ content: [{ text: "tool aborted", type: "text" }], details: {} }),
      { once: true },
    );
    return aborted.promise;
  },
  label: "Block",
  name: "block",
  parameters: Type.Object({}),
});

const createForkableRuntime = (toolStarted: ReturnType<typeof gate>) =>
  Effect.gen(function* () {
    const harness = yield* Effect.promise(() =>
      createHarness({ tools: [blockingTool(toolStarted)] }),
    );
    const services: agentSessionRuntimeTypes.AgentSessionServices = {
      agentDir: harness.tempDir,
      cwd: harness.tempDir,
      diagnostics: [],
      modelRuntime: harness.session.modelRuntime,
      resourceLoader: harness.session.resourceLoader,
      settingsManager: harness.settingsManager,
    };
    const createRuntime: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory = ({
      sessionManager,
      sessionStartEvent,
    }) =>
      createAgentSessionFromServices({
        services,
        sessionManager,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        model: harness.getModel(),
        noTools: "all",
      }).then((created) => ({ ...created, diagnostics: [], services }));
    const runtime = new AgentSessionRuntime(harness.session, services, createRuntime);
    cleanups.push(() =>
      runtime.session === harness.session
        ? harness.cleanup()
        : runtime.dispose().then(() => harness.cleanup()),
    );
    return { harness, runtime };
  });

const doesNotAppendTheAbortedTurn = Effect.gen(function* () {
  const toolStarted = gate();
  const { harness, runtime } = yield* createForkableRuntime(toolStarted);

  harness.setResponses([
    fauxAssistantMessage("first response"),
    fauxAssistantMessage(fauxToolCall("block", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("unused after abort"),
  ]);
  yield* Effect.promise(() => runtime.session.prompt("first prompt"));
  const firstUserEntryId = runtime.session.getUserMessagesForForking()[0]?.entryId;
  expect(firstUserEntryId).toBeDefined();

  const outgoingPrompt = runtime.session.prompt("start blocking tool");
  yield* Effect.promise(() => toolStarted);
  const forkResult = yield* Effect.promise(() => runtime.fork(firstUserEntryId!));
  yield* Effect.promise(() => outgoingPrompt);
  yield* Effect.promise(() => runtime.session.bindExtensions({}));

  expect(forkResult).toEqual({ cancelled: false, selectedText: "first prompt" });
  expect(runtime.session.messages.map((message) => message.role)).toEqual(["system"]);
  expect(
    runtime.session.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message.role),
  ).toEqual(["system"]);

  let capturedRoles: string[] = [];
  harness.setResponses([
    (context) => {
      capturedRoles = context.messages.map((message) => message.role);
      return fauxAssistantMessage("next response");
    },
  ]);
  yield* Effect.promise(() => runtime.session.prompt("next prompt"));

  expect(capturedRoles).toEqual(["system", "system", "user"]);
});

const doesNotAppendTheAbortedTurnTo = () => Effect.runPromise(doesNotAppendTheAbortedTurn);

const afterEachHook = Effect.gen(function* () {
  while (cleanups.length > 0) {
    yield* Effect.promise(() => Promise.resolve(cleanups.pop()?.()));
  }
});

describe("regression #8724: in-memory fork during an active tool turn", () => {
  afterEach(() => runTest(afterEachHook));
  it("does not append the aborted turn to the replacement session", doesNotAppendTheAbortedTurnTo);
});
