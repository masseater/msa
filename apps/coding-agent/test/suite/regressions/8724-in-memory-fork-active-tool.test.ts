import type { AgentTool, AgentToolResult } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  AgentSessionRuntime,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
} from "../../../src/core/agent-session-runtime.ts";
import { createHarness } from "../harness.ts";

const cleanups: Array<() => Promise<void> | void> = [];

const doesNotAppendTheAbortedTurn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolStarted = gate();
  const blockingTool: AgentTool = {
    name: "block",
    label: "Block",
    description: "Wait until aborted",
    parameters: Type.Object({}),
    execute: (_toolCallId, _params, signal) =>
      new Promise<AgentToolResult<unknown>>((resolve) => {
        toolStarted.release();
        signal?.addEventListener(
          "abort",
          () => resolve({ content: [{ type: "text", text: "tool aborted" }], details: {} }),
          { once: true },
        );
      }),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [blockingTool] }));
  const services: AgentSessionServices = {
    cwd: harness.tempDir,
    agentDir: harness.tempDir,
    modelRuntime: harness.session.modelRuntime,
    settingsManager: harness.settingsManager,
    resourceLoader: harness.session.resourceLoader,
    diagnostics: [],
  };
  const createRuntime: CreateAgentSessionRuntimeFactory = ({ sessionManager, sessionStartEvent }) =>
    runPromise(
      Effect.gen(function* () {
        return {
          ...(yield* Effect.promise(() =>
            createAgentSessionFromServices({
              services,
              sessionManager,
              ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
              model: harness.getModel(),
              noTools: "all",
            }),
          )),
          services,
          diagnostics: [],
        };
      }),
    );
  const runtime = new AgentSessionRuntime(harness.session, services, createRuntime);
  cleanups.push(() =>
    runPromise(
      Effect.gen(function* () {
        if (runtime.session !== harness.session) {
          yield* Effect.promise(() => runtime.dispose());
        }
        harness.cleanup();
      }),
    ),
  );

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

describe("regression #8724: in-memory fork during an active tool turn", () => {
  afterEach(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        while (cleanups.length > 0) {
          yield* Effect.promise(() => Promise.resolve(cleanups.pop()?.()));
        }
      }),
    ),
  );
  it("does not append the aborted turn to the replacement session", () =>
    Effect.runPromise(doesNotAppendTheAbortedTurn));
});
