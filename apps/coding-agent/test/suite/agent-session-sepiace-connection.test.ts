import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import SecretStoreAuthBackend from "../../src/extensions/mcp/credentials/secret-store-backend.ts";
import agentSessionAskSupport from "./agent-session-ask-support.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import sepiaceMemoryFixtures from "./sepiace-memory-fixtures.ts";
import sepiaceMemorySupport from "./sepiace-memory-support.ts";

const { fauxAssistantMessage } = ai;
const { joinPath, makeTempDir, pathExists, removeDir, runTest } = testing;
const { runCleanups } = agentSessionMcpOauthHarness;
const { openSession, startSepiace } = sepiaceMemorySupport;
const { operationOf, writeLegacyDatabase } = sepiaceMemoryFixtures;
const { declared, record } = agentSessionAskSupport;

afterEach(() => runCleanups());

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
  expect(yield* Effect.promise(() => service?.signOut() ?? Promise.resolve(false))).toBe(true);
  expect(service?.connection.state).toBe("missing");
  const legacy = joinPath(harness.session.agentDir, "memory.db");
  writeLegacyDatabase(legacy);
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  expect(yield* waitForLegacyMove(legacy)).toBe(false);
  expect(server.memoryRequests).toEqual([]);
  expect(service?.connection.state).toBe("missing");
});

const offersOnlyTheMemoryTool = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => "Releases go to the tap."));
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  const requests = record(harness, [fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("where does the release go?"));
  const tools = declared(requests[0]);
  expect(tools).toContain("memory");
  expect(tools.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  expect(
    [...harness.session.tools.registry.toolRegistry.keys()].filter((name) =>
      name.startsWith("mcp__"),
    ),
  ).toEqual([]);
});

const warnsWhenTheSignInIsNotSaved = Effect.gen(function* () {
  const agentDir = yield* makeTempDir("msa-sepiace-signin-");
  const server = yield* Effect.promise(() => startSepiace(() => ""));
  const { harness, note } = yield* Effect.promise(() =>
    openSession({
      agentDir,
      backend: new SecretStoreAuthBackend({ agentDir, defaultStore: lockedKeychain }),
      url: server.url,
    }),
  );
  expect(note).toContain("MCP sign-ins are not saved, because User interaction is not allowed;");
  expect(note).toContain(
    `credentialHelper to a docker-credential helper in ${joinPath(agentDir, "mcp.json")}`,
  );
  expect(harness.session.integrations.memory.memory?.status(false)).toContain("Sign-in: not saved");
  yield* Effect.ignore(removeDir(agentDir));
});

describe("sepiace connection", () => {
  it("asks sepiace a question for recall, so a prompt that says forget changes nothing", () =>
    Effect.runPromise(recallNeverSavesOrForgets));
  it("reports memory as not connected and moves nothing after signing out", () =>
    Effect.runPromise(signOutLeavesMemoryUnconnected));
  it("gives the model the memory tool and no mcp__ tools of sepiace", () =>
    Effect.runPromise(offersOnlyTheMemoryTool));
  it("tells the sign-in and /memory when the sign-in can only be kept in memory", () =>
    runTest(warnsWhenTheSignInIsNotSaved));
});
