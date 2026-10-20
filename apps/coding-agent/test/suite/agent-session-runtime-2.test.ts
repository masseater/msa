import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { AgentSession } from "../../src/core/agent-session.ts";
import runtimeKit from "../runtime-kit.ts";
import agentSessionRuntimeSupport from "./agent-session-runtime-support.ts";

const { awaited, runTest } = testing;
const { createFauxRuntime, disposeRuntimes } = runtimeKit;
const { createRuntimeForTest } = agentSessionRuntimeSupport;

const userTextOf = (message: AgentSession["messages"][number]): string | undefined => {
  if (message.role !== "user") {
    return undefined;
  }
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
};

const branchOf = (session: AgentSession) =>
  session.messages.map((message) => ({ role: message.role, text: userTextOf(message) }));

const forkAtLeaf = Effect.fn("forkAtLeaf")(function* (
  session: AgentSession,
  fork: (leafId: string) => Promise<unknown>,
) {
  yield* awaited(session.prompt("hello"));
  yield* awaited(session.prompt("again"));
  const beforeMessages = branchOf(session);
  const leafId = session.sessionManager.getLeafId();
  expect(leafId).toBeTruthy();
  const result = yield* awaited(fork(leafId ?? ""));
  return { beforeMessages, result };
});

const duplicatesTheActiveBranchWhenForking = Effect.gen(function* () {
  const { runtime } = yield* createRuntimeForTest();
  const previousSessionFile = runtime.session.sessionFile;
  const { beforeMessages, result } = yield* forkAtLeaf(runtime.session, (leafId) =>
    runtime.fork(leafId, { position: "at" }),
  );
  expect(result).toEqual({ cancelled: false, selectedText: undefined });
  expect(runtime.session.sessionFile).not.toBe(previousSessionFile);
  expect(branchOf(runtime.session)).toEqual(beforeMessages);
});

const duplicatesTheActiveBranchInMemory = Effect.gen(function* () {
  const { runtime } = yield* createFauxRuntime({
    inMemory: true,
    models: [
      { id: "faux-1", reasoning: true },
      { id: "faux-2", reasoning: false },
    ],
  });
  const { beforeMessages, result } = yield* forkAtLeaf(runtime.session, (leafId) => {
    expect(runtime.session.sessionFile).toBeUndefined();
    return runtime.fork(leafId, { position: "at" });
  });
  expect(result).toEqual({ cancelled: false, selectedText: undefined });
  expect(runtime.session.sessionFile).toBeUndefined();
  expect(branchOf(runtime.session)).toEqual(beforeMessages);
});

const throwsWhenForkingWithAnInvalidEntry = Effect.gen(function* () {
  const { runtime } = yield* createRuntimeForTest();
  yield* awaited(
    expect(runtime.fork("missing-entry")).rejects.toThrow("Invalid entry ID for forking"),
  );
});

describe("AgentSessionRuntime forking", () => {
  afterEach(() => runTest(disposeRuntimes));

  it("duplicates the current active branch when forking at the current position", () =>
    runTest(duplicatesTheActiveBranchWhenForking));

  it("duplicates the current active branch in-memory when forking at the current position", () =>
    runTest(duplicatesTheActiveBranchInMemory));

  it("throws when forking with an invalid entry id", () =>
    runTest(throwsWhenForkingWithAnInvalidEntry));
});
