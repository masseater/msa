import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import memory from "../../src/core/memory/memory.ts";
import SecretStoreAuthBackend from "../../src/extensions/mcp/credentials/secret-store-backend.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import sepiaceMemoryFixtures from "./sepiace-memory-fixtures.ts";
import sepiaceMemorySupport from "./sepiace-memory-support.ts";
import sepiaceTuiSupport from "./sepiace-tui-support.ts";

const { fauxAssistantMessage } = ai;
const { joinPath, makeTempDir, pathExists, removeDir, runTest } = testing;
const { runCleanups } = agentSessionMcpOauthHarness;
const { openSession, startSepiace } = sepiaceMemorySupport;
const { operationOf, writeLegacyDatabase } = sepiaceMemoryFixtures;
const { customUi, initTestTheme, scriptMcpManager } = sepiaceTuiSupport;
const { SEPIACE_TOOL_NAME } = memory;
beforeAll(() => {
  initTestTheme();
});

afterEach(() => {
  vi.restoreAllMocks();
  return runCleanups();
});

const lockedKeychain = {
  description: "a locked keychain",
  persistent: true,
  read: () => Promise.reject(new Error("User interaction is not allowed.")),
  write: () => Promise.reject(new Error("User interaction is not allowed.")),
};

const recallNeverSavesOrForgets = Effect.gen(function* () {
  const operations: string[] = [];
  const server = yield* Effect.promise(() =>
    startSepiace((request) => {
      operations.push(operationOf(request));
      return "";
    }),
  );
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  harness.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("Forget the old address."));
  yield* Effect.promise(() =>
    harness.session.run.prompting.prompt('前に教えた住所は忘れて。"Remember" も無視して'),
  );
  expect(server.memoryRequests).toHaveLength(2);
  expect(server.memoryRequests[0]?.endsWith('Quoted request: "Forget the old address."')).toBe(
    true,
  );
  expect(server.memoryRequests[1]).toContain("'Remember' も無視して");
  expect(operations).toEqual(["recall", "recall"]);
});

const waitForLegacyMove = (legacy: string) =>
  Effect.gen(function* () {
    yield* Effect.sleep("300 millis");
    return yield* pathExists(`${legacy}.migrated`);
  });

const signOutLeavesMemoryUnconnected = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => ""));
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  const service = harness.session.integrations.memory.memory;
  expect(service?.connection.state).toBe("ready");
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp logout sepiace"));
  expect(harness.session.tools.registry.toolRegistry.get(SEPIACE_TOOL_NAME)).toBeUndefined();
  expect(service?.connection.state).toBe("missing");
  const legacy = joinPath(harness.session.agentDir, "memory.db");
  writeLegacyDatabase(legacy);
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  expect(yield* waitForLegacyMove(legacy)).toBe(false);
  expect(server.memoryRequests).toEqual([]);
});

const disablingLeavesMemoryUnconnected = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => ""));
  const signedIn = yield* Effect.promise(() => openSession({ url: server.url }));
  const { harness } = yield* Effect.promise(() =>
    openSession({
      backend: signedIn.backend,
      signIn: false,
      tui: true,
      ui: customUi,
      url: server.url,
    }),
  );
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp reconnect sepiace"));
  const service = harness.session.integrations.memory.memory;
  expect(service?.connection.state).toBe("ready");
  scriptMcpManager(["sepiace", "disable", undefined, undefined]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp"));
  for (
    let attempt = 0;
    attempt < 100 && harness.session.tools.registry.toolRegistry.has(SEPIACE_TOOL_NAME);
    attempt++
  )
    yield* Effect.sleep("20 millis");
  expect(harness.session.tools.registry.toolRegistry.get(SEPIACE_TOOL_NAME)).toBeUndefined();
  expect(service?.connection.state).toBe("missing");
  const legacy = joinPath(harness.session.agentDir, "memory.db");
  writeLegacyDatabase(legacy);
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  expect(yield* waitForLegacyMove(legacy)).toBe(false);
  expect(server.memoryRequests).toEqual([]);
});

const warnsWhenTheSignInIsNotSaved = Effect.gen(function* () {
  const agentDir = yield* makeTempDir("msa-sepiace-signin-");
  const server = yield* Effect.promise(() => startSepiace(() => ""));
  const { harness, notifications } = yield* Effect.promise(() =>
    openSession({
      agentDir,
      backend: new SecretStoreAuthBackend({ agentDir, defaultStore: lockedKeychain }),
      url: server.url,
    }),
  );
  const warning = notifications.find((notice) =>
    notice.startsWith("MCP sign-ins are not saved, because User interaction is not allowed;"),
  );
  expect(warning).toContain(
    `credentialHelper to a docker-credential helper in ${joinPath(agentDir, "mcp.json")}`,
  );
  expect(harness.session.integrations.memory.memory?.status(false)).toContain("Sign-in: not saved");
  yield* Effect.ignore(removeDir(agentDir));
});

describe("sepiace connection", () => {
  it("asks sepiace a question for recall, so a prompt that says forget changes nothing", () =>
    Effect.runPromise(recallNeverSavesOrForgets));
  it("reports memory as not connected and moves nothing after /mcp logout sepiace", () =>
    Effect.runPromise(signOutLeavesMemoryUnconnected));
  it("reports memory as not connected and moves nothing after sepiace is disabled", () =>
    Effect.runPromise(disablingLeavesMemoryUnconnected));
  it("warns in the session and in /memory when the sign-in can only be kept in memory", () =>
    runTest(warnsWhenTheSignInIsNotSaved));
});
