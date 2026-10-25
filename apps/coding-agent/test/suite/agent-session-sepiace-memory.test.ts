import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionAskSupport from "./agent-session-ask-support.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import harnessModule from "./harness.ts";
import sepiaceMemoryFixtures from "./sepiace-memory-fixtures.ts";
import sepiaceMemorySupport from "./sepiace-memory-support.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;
const { joinPath, makeDirectory, pathExists } = testing;
const { getMessageText, getToolResult } = harnessModule;
const { runCleanups } = agentSessionMcpOauthHarness;
const { openSession, startSepiace } = sepiaceMemorySupport;
const { fakeGitHubToken, longMemorySentences, recalls, waitForFile, writeLegacyDatabase } =
  sepiaceMemoryFixtures;
const { declared, record } = agentSessionAskSupport;

afterEach(() => runCleanups());

const callMemoryTool = (
  harness: Awaited<ReturnType<typeof openSession>>["harness"],
  request: string,
) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage([fauxToolCall("memory", { request })], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("use memory"));
    return getToolResult(harness, "memory");
  });

const sendsTheToolRequestToSepiace = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace((request) => `got: ${request}`));
  const { harness } = yield* Effect.promise(() =>
    openSession({ settings: { memory: { recall: { enabled: false } } }, url: server.url }),
  );
  const result = yield* callMemoryTool(harness, "Remember that the user prefers pnpm.");
  expect(server.memoryRequests).toEqual(["Remember that the user prefers pnpm."]);
  expect(result.isError).toBe(false);
  expect(getMessageText(result)).toBe("got: Remember that the user prefers pnpm.");
});

const addsRecalledMemoriesAsAHiddenMessage = Effect.gen(function* () {
  const server = yield* Effect.promise(() =>
    startSepiace((request) => (request.includes("release") ? "Releases go to the tap." : "")),
  );
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  harness.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("where does the release go?"));
  const recalled = recalls(harness.session.messages);
  expect(server.memoryRequests.at(-1)).toContain("where does the release go?");
  expect(recalled).toHaveLength(1);
  expect(recalled[0]?.display).toBe(false);
  expect(recalled[0]?.text).toContain("Releases go to the tap.");

  yield* Effect.promise(() => harness.session.run.prompting.prompt("what is the weather?"));
  expect(server.memoryRequests.at(-1)).toContain("what is the weather?");
  expect(recalls(harness.session.messages)).toHaveLength(1);
});

const keepsSecretsAwayFromSepiace = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => "remembered"));
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  const result = yield* callMemoryTool(harness, `Remember the token ${fakeGitHubToken()}.`);
  expect(result.isError).toBe(true);
  const suppressed = yield* callMemoryTool(
    harness,
    `secretlint-disable\nRemember the token ${fakeGitHubToken()}.`,
  );
  expect(suppressed.isError).toBe(true);
  const before = recalls(harness.session.messages).length;
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() =>
    harness.session.run.prompting.prompt(`my token is ${fakeGitHubToken()}`),
  );
  expect(server.memoryRequests.filter((request) => request.includes("ghp_"))).toEqual([]);
  expect(recalls(harness.session.messages)).toHaveLength(before);
});

const reportsAnUnreachableSepiace = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => "remembered"));
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  expect(harness.session.integrations.memory.memory?.connection.state).toBe("ready");
  yield* Effect.promise(() => server.close());
  const result = yield* callMemoryTool(harness, "Remember that the user prefers pnpm.");
  expect(result.isError).toBe(true);
  expect(harness.session.integrations.memory.memory?.connection.state).toBe("failing");
  expect(recalls(harness.session.messages)).toHaveLength(0);
});

const omitsMemoryWhenDisabled = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => "remembered"));
  const { harness } = yield* Effect.promise(() =>
    openSession({ settings: { memory: { enabled: false } }, signIn: false, url: server.url }),
  );
  const requests = record(harness, [fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("where does the release go?"));
  expect(declared(requests[0])).not.toContain("memory");
  const result = yield* callMemoryTool(harness, "Remember that the user prefers pnpm.");
  expect(result.isError).toBe(true);
  expect(server.memoryRequests).toEqual([]);
});

const movesTheLegacyDatabaseOnce = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => ""));
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  const legacy = joinPath(harness.session.agentDir, "memory.db");
  writeLegacyDatabase(legacy);
  harness.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  expect(yield* waitForFile(`${legacy}.migrated`)).toBe(true);
  expect(yield* pathExists(legacy)).toBe(false);
  const moved = server.memoryRequests.filter((request) => !request.includes("hello"));
  expect(moved.some((request) => request.includes("the release goes to the Homebrew tap"))).toBe(
    true,
  );
  expect(moved.some((request) => request.includes("tap-repo"))).toBe(true);
  expect(moved.some((request) => request.includes("commit messages in Japanese"))).toBe(true);
  expect(server.memoryRequests.some((request) => request.includes("ghp_"))).toBe(false);
  const sentText = moved.join("\n");
  expect(longMemorySentences.filter((sentence) => !sentText.includes(sentence))).toEqual([]);
  expect(moved.every((request) => request.length <= 4000)).toBe(true);
  const notices = () => harness.eventsOfType("memory_status").map((event) => event.text);
  for (let attempt = 0; attempt < 100 && notices().length === 0; attempt++)
    yield* Effect.sleep("20 millis");
  expect(notices().length).toBeGreaterThan(0);
  expect(notices().some((notice) => notice.includes("ghp_"))).toBe(false);

  const sent = server.memoryRequests.length;
  yield* Effect.promise(() => harness.session.run.prompting.prompt("again"));
  expect(server.memoryRequests.slice(sent).every((request) => request.includes("again"))).toBe(
    true,
  );
});

const movesADatabaseAtTheConfiguredPath = Effect.gen(function* () {
  const server = yield* Effect.promise(() => startSepiace(() => ""));
  const { harness } = yield* Effect.promise(() =>
    openSession({ settings: { memory: { database: "old/memories.db" } }, url: server.url }),
  );
  const legacy = joinPath(harness.session.agentDir, "old", "memories.db");
  yield* makeDirectory(joinPath(harness.session.agentDir, "old"));
  writeLegacyDatabase(legacy);
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  expect(yield* waitForFile(`${legacy}.migrated`)).toBe(true);
  expect(
    server.memoryRequests.some((request) => request.includes("commit messages in Japanese")),
  ).toBe(true);
});

const resumesWithoutResendingAPiece = Effect.gen(function* () {
  let failed = false;
  const server = yield* Effect.promise(() =>
    startSepiace((request) => {
      if (!failed && request.includes("Long note sentence 120 ")) {
        failed = true;
        return { error: "try again later" };
      }
      return "";
    }),
  );
  const first = yield* Effect.promise(() => openSession({ url: server.url }));
  const legacy = joinPath(first.harness.session.agentDir, "memory.db");
  writeLegacyDatabase(legacy);
  first.harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => first.harness.session.run.prompting.prompt("hello"));
  const firstNotices = () => first.harness.eventsOfType("memory_status");
  for (let attempt = 0; attempt < 100 && firstNotices().length === 0; attempt++)
    yield* Effect.sleep("20 millis");
  expect(failed).toBe(true);
  expect(yield* pathExists(legacy)).toBe(true);

  const second = yield* Effect.promise(() =>
    openSession({
      backend: first.backend,
      settings: { memory: { database: legacy } },
      url: server.url,
    }),
  );
  second.harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => second.harness.session.run.prompting.prompt("again"));
  expect(yield* waitForFile(`${legacy}.migrated`)).toBe(true);
  const pieces = server.memoryRequests.filter((request) => request.includes("Long note sentence"));
  const sentText = pieces.join("\n");
  const count = (sentence: string) => sentText.split(sentence).length - 1;
  expect(longMemorySentences.filter((sentence) => count(sentence) === 0)).toEqual([]);
  expect(count("Long note sentence 1 stays whole.")).toBe(1);
  const secondNotices = () =>
    second.harness.eventsOfType("memory_status").map((event) => event.text);
  for (let attempt = 0; attempt < 100 && secondNotices().length === 0; attempt++)
    yield* Effect.sleep("20 millis");
  expect(secondNotices().some((notice) => notice.includes("m3"))).toBe(true);
});

describe("sepiace memory", () => {
  it("sends the memory tool request to sepiace and returns its reply", () =>
    Effect.runPromise(sendsTheToolRequestToSepiace));
  it("adds what sepiace recalls for a prompt as a hidden message, and nothing when it recalls nothing", () =>
    Effect.runPromise(addsRecalledMemoriesAsAHiddenMessage));
  it("does not send requests that hold a secret", () =>
    Effect.runPromise(keepsSecretsAwayFromSepiace));
  it("fails the tool and skips recall when sepiace cannot be reached", () =>
    Effect.runPromise(reportsAnUnreachableSepiace));
  it("registers no memory tool and recalls nothing when memory is disabled", () =>
    Effect.runPromise(omitsMemoryWhenDisabled));
  it("moves memory.db into sepiace once and leaves secrets behind", () =>
    Effect.runPromise(movesTheLegacyDatabaseOnce));
  it("resumes a failed migration without resending a piece and still names the memories left behind", () =>
    Effect.runPromise(resumesWithoutResendingAPiece));
  it("moves the database that memory.database pointed at", () =>
    Effect.runPromise(movesADatabaseAtTheConfiguredPath));
});
