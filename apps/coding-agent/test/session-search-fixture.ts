import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import storeModule from "../src/core/orchestrator/store.ts";
import type orchestratorTypesTypes from "../src/core/orchestrator/types.types.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import indexStore from "../src/core/session-search/index-store.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";

const { store } = storeModule;
const { dirnameOf, joinPath, makeDirectory, makeTempDir, readTextFile, toJsonText, writeTextFile } =
  testing;

type FileEntry = sessionManagerTypes.FileEntry;

const usage: aiTypes.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 1,
  output: 1,
  totalTokens: 2,
};

const millis = (timestamp: string): number => Date.parse(timestamp);

function header(id: string, cwd: string, timestamp: string): sessionManagerTypes.SessionHeader {
  return { cwd, id, timestamp, type: "session", version: 3 };
}

function messageEntry(
  id: string,
  timestamp: string,
  message: sessionManagerTypes.SessionMessageEntry["message"],
): sessionManagerTypes.SessionMessageEntry {
  return { id, message, parentId: null, timestamp, type: "message" };
}

function user(id: string, timestamp: string, text: string): FileEntry {
  return messageEntry(id, timestamp, {
    content: [{ text, type: "text" }],
    role: "user",
    timestamp: millis(timestamp),
  });
}

function assistant(
  id: string,
  timestamp: string,
  content: aiTypes.AssistantMessage["content"],
): FileEntry {
  return messageEntry(id, timestamp, {
    api: "anthropic-messages",
    content,
    model: "claude-test",
    provider: "anthropic",
    role: "assistant",
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp: millis(timestamp),
    usage,
  });
}

function toolCall(id: string, name: string, args: aiTypes.ToolCall["arguments"]): aiTypes.ToolCall {
  return { arguments: args, id, name, type: "toolCall" };
}

function toolResult(id: string, timestamp: string, toolName: string, text: string): FileEntry {
  return messageEntry(id, timestamp, {
    content: [{ text, type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: millis(timestamp),
    toolCallId: `call-${id}`,
    toolName,
  });
}

const sessionText = Effect.fn("sessionText")(function* (entries: readonly FileEntry[]) {
  const lines = yield* Effect.forEach(entries, (entry) => toJsonText(entry));
  return lines.map((line) => `${line}\n`).join("");
});

const writeSession = Effect.fn("writeSession")(function* (
  path: string,
  entries: readonly FileEntry[],
) {
  yield* makeDirectory(dirnameOf(path));
  yield* writeTextFile(path, yield* sessionText(entries));
  return path;
});

const makeLocations = Effect.fn("makeLocations")(function* (directories: string[]) {
  const agentDir = yield* makeTempDir("msa-session-search-");
  directories.push(agentDir);
  const locations: sessionSearchTypes.Locations = {
    indexDirectory: joinPath(agentDir, "session-index"),
    orchestratorDatabase: joinPath(agentDir, "orchestrator.db"),
    roots: [joinPath(agentDir, "sessions")],
  };
  return locations;
});

const DEPTH = 30_000;

const deeplyNestedCall = (id: string, timestamp = "2026-10-01T12:00:00.000Z"): string =>
  `{"type":"message","id":"${id}","parentId":null,"timestamp":"${timestamp}","message":{"role":"assistant","content":[{"type":"toolCall","id":"call","name":"bash","arguments":${'{"a":'.repeat(DEPTH)}"deep"${"}".repeat(DEPTH)}}],"api":"anthropic-messages","model":"m","provider":"anthropic","stopReason":"toolUse","timestamp":0,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}\n`;

const indexVersionDirectory = (locations: sessionSearchTypes.Locations): string =>
  joinPath(locations.indexDirectory, `v${indexStore.SCHEMA_VERSION}`);

const currentIndexPath = Effect.fn("currentIndexPath")(function* (
  locations: sessionSearchTypes.Locations,
) {
  const directory = indexVersionDirectory(locations);
  const name = (yield* readTextFile(joinPath(directory, "current"))).trim();
  return joinPath(directory, name);
});

interface ThreadSeed {
  threadId: string;
  taskId: string;
  round: string;
  role: orchestratorTypesTypes.ThreadRole;
  sessionFile: string;
}

function insertTask(database: ReturnType<typeof store.openDatabase>, seed: ThreadSeed): void {
  store.insertTask(database, {
    checks: [],
    condition: null,
    createdAt: 1,
    currentState: "now",
    cwd: "/work",
    goalState: "goal",
    id: seed.taskId,
    kind: "work",
    mergeInto: null,
    model: null,
    opensPullRequest: true,
    project: "p",
    round: seed.round,
    status: "completed",
    thinkingLevel: null,
    title: seed.taskId,
    updatedAt: 1,
  });
}

function seedThreads(orchestratorDatabase: string, seeds: readonly ThreadSeed[]): void {
  const database = store.openDatabase(orchestratorDatabase);
  const tasks = new Set<string>();
  for (const seed of seeds) {
    if (!tasks.has(seed.taskId)) insertTask(database, seed);
    tasks.add(seed.taskId);
    store.insertThread(database, {
      branch: null,
      createdAt: 1,
      cwd: "/work",
      id: seed.threadId,
      model: "m",
      project: "p",
      sessionFile: seed.sessionFile,
      status: "completed",
      targetBranch: null,
      thinkingLevel: "low",
      updatedAt: 1,
    });
    store.insertAssignment(database, {
      createdAt: 1,
      role: seed.role,
      taskId: seed.taskId,
      threadId: seed.threadId,
    });
  }
  database.close();
}

const sessionSearchFixture = {
  assistant,
  currentIndexPath,
  deeplyNestedCall,
  header,
  indexVersionDirectory,
  makeLocations,
  seedThreads,
  sessionText,
  toolCall,
  toolResult,
  user,
  writeSession,
};

export default sessionSearchFixture;
