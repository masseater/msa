import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import sessionManagerSupport from "../../src/core/session-manager-support.ts";
import SessionManager from "../../src/core/session-manager.ts";
import fileOperationsSupport from "./file-operations-support.ts";

const { findMostRecentSession } = sessionManagerSupport;

const { HEADER_SCAN_LIMIT_BYTES } = fileOperationsSupport;

const {
  abortController,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir3: string;

const returnsSingleValidSessionFile = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir3, "session.jsonl");
      yield* writeTextFile(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );
      expect(findMostRecentSession(tempDir3)).toBe(file);
    }),
  );

const returnsMostRecentlyModifiedSession = Effect.gen(function* () {
  const file1 = joinPath(tempDir3, "older.jsonl");
  const file2 = joinPath(tempDir3, "newer.jsonl");

  yield* writeTextFile(
    file1,
    '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  yield* Effect.sleep(10);
  yield* writeTextFile(
    file2,
    '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  expect(findMostRecentSession(tempDir3)).toBe(file2);
});

const skipsInvalidFilesAndReturnsValid = Effect.gen(function* () {
  const invalid = joinPath(tempDir3, "invalid.jsonl");
  const valid = joinPath(tempDir3, "valid.jsonl");

  yield* writeTextFile(invalid, '{"type":"not-session"}\n');
  yield* Effect.sleep(10);
  yield* writeTextFile(
    valid,
    '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  expect(findMostRecentSession(tempDir3)).toBe(valid);
});

const skipsOversizedCorruptFilesAndReturns = () =>
  runTest(
    Effect.gen(function* () {
      const invalid = joinPath(tempDir3, "oversized.jsonl");
      const valid = joinPath(tempDir3, "valid.jsonl");
      yield* writeTextFile(invalid, "x".repeat(HEADER_SCAN_LIMIT_BYTES + 1));
      yield* writeTextFile(
        valid,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );

      expect(findMostRecentSession(tempDir3)).toBe(valid);
    }),
  );

const filtersMostRecentSessionByCwd = Effect.gen(function* () {
  const projectA = joinPath(tempDir3, "project-a");
  const projectB = joinPath(tempDir3, "project-b");
  const fileA = joinPath(tempDir3, "a.jsonl");
  const fileB = joinPath(tempDir3, "b.jsonl");

  yield* writeTextFile(
    fileA,
    `${yield* toJsonText({ cwd: projectA, id: "a", timestamp: "2025-01-01T00:00:00Z", type: "session" })}\n`,
  );
  yield* Effect.sleep(10);
  yield* writeTextFile(
    fileB,
    `${yield* toJsonText({ cwd: projectB, id: "b", timestamp: "2025-01-01T00:00:00Z", type: "session" })}\n`,
  );

  expect(findMostRecentSession(tempDir3, projectA)).toBe(fileA);
  expect(findMostRecentSession(tempDir3, projectB)).toBe(fileB);
});

const returnsNullForEmptyDirectory = () => {
  expect(findMostRecentSession(tempDir3)).toBeNull();
};

const returnsNullForNonExistentDirectory = () => {
  expect(findMostRecentSession(joinPath(tempDir3, "nonexistent"))).toBeNull();
};

const ignoresNonJsonlFiles = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(tempDir3, "file.txt"), "hello");
      yield* writeTextFile(joinPath(tempDir3, "file.json"), "{}");
      expect(findMostRecentSession(tempDir3)).toBeNull();
    }),
  );

const ignoresJsonlFilesWithoutValidSessionHeader = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(tempDir3, "invalid.jsonl"), '{"type":"message"}\n');
      expect(findMostRecentSession(tempDir3)).toBeNull();
    }),
  );

const returnsMostRecentlyModifiedSession2 = () =>
  Effect.runPromise(returnsMostRecentlyModifiedSession);

const skipsInvalidFilesAndReturnsValidOne = () =>
  Effect.runPromise(skipsInvalidFilesAndReturnsValid);

const filtersMostRecentSessionByCwd2 = () => Effect.runPromise(filtersMostRecentSessionByCwd);

const beforeEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      tempDir3 = yield* makeTempDir(`session-test-`);
      yield* makeDirectory(tempDir3);
    }),
  );

describe("findMostRecentSession", () => {
  beforeEach(beforeEachHook2);
  afterEach(() => runTest(removePath(tempDir3)));
  it("returns null for empty directory", returnsNullForEmptyDirectory);
  it("returns null for non-existent directory", returnsNullForNonExistentDirectory);
  it("ignores non-jsonl files", ignoresNonJsonlFiles);
  it(
    "ignores jsonl files without valid session header",
    ignoresJsonlFilesWithoutValidSessionHeader,
  );
  it("returns single valid session file", returnsSingleValidSessionFile);
  it("returns most recently modified session", returnsMostRecentlyModifiedSession2);
  it("skips invalid files and returns valid one", skipsInvalidFilesAndReturnsValidOne);
  it(
    "skips oversized corrupt files and returns a valid session",
    skipsOversizedCorruptFilesAndReturns,
  );
  it("filters most recent session by cwd", filtersMostRecentSessionByCwd2);
});

let tempDir4: string;

let projectA: string;

let projectB: string;

function createPersistedSession(cwd: string, label: string): string {
  const session = SessionManager.create(cwd, tempDir4);
  session.appendMessage({ content: label, role: "user", timestamp: currentTimeMillis() });
  session.appendMessage({
    api: "anthropic-messages",
    content: [{ text: `reply to ${label}`, type: "text" }],
    model: "test",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 1,
      output: 1,
      totalTokens: 2,
    },
  });
  const sessionFile = session.getSessionFile();
  if (sessionFile === undefined || sessionFile === "") {
    throw new Error("Expected persisted session file");
  }
  return sessionFile;
}

const scopesCurrentFolderApisByCwd = Effect.gen(function* () {
  const sessionA = createPersistedSession(projectA, "from A");
  yield* Effect.sleep(10);
  const sessionB = createPersistedSession(projectB, "from B");

  const currentA = yield* Effect.promise(() => SessionManager.list(projectA, tempDir4));
  expect(currentA.map((session) => session.path)).toEqual([sessionA]);

  const all = yield* Effect.promise(() => SessionManager.listAll(tempDir4));
  expect(new Set(all.map((session) => session.path))).toEqual(new Set([sessionA, sessionB]));

  const continuedA = SessionManager.continueRecent(projectA, tempDir4);
  expect(continuedA.getSessionFile()).toBe(sessionA);
});

const rejectsACancelledSessionListing = Effect.gen(function* () {
  createPersistedSession(projectA, "from A");
  createPersistedSession(projectB, "from B");
  const controller = abortController();
  const listing = SessionManager.listAll(
    tempDir4,
    (_loaded, _total, partialSessions) => {
      if (partialSessions !== undefined) controller.abort();
    },
    controller.signal,
  );

  yield* Effect.promise(() => expect(listing).rejects.toMatchObject({ name: "AbortError" }));
  yield* Effect.promise(() =>
    expect(SessionManager.listAll(undefined, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    }),
  );
});

const scopesCurrentFolderApisByCwdWhile = () => Effect.runPromise(scopesCurrentFolderApisByCwd);

const rejectsACancelledSessionListing2 = () => Effect.runPromise(rejectsACancelledSessionListing);

const beforeEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      tempDir4 = yield* makeTempDir(`session-test-`);
      projectA = joinPath(tempDir4, "project-a");
      projectB = joinPath(tempDir4, "project-b");
      yield* makeDirectory(projectA);
      yield* makeDirectory(projectB);
    }),
  );

describe("SessionManager custom flat session directory", () => {
  beforeEach(beforeEachHook3);
  afterEach(() => runTest(removePath(tempDir4)));
  it(
    "scopes current-folder APIs by cwd while listing all flat sessions",
    scopesCurrentFolderApisByCwdWhile,
  );
  it("rejects a cancelled session listing", rejectsACancelledSessionListing2);
});
