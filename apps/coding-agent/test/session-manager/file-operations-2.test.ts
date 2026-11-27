import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import sessionFiles from "../../src/core/session-manager/session-files.ts";
import tempDirKit from "../temp-dir.ts";
import fileOperationsSupport from "./file-operations-support.ts";

const { findMostRecentSession } = sessionFiles;

const { HEADER_SCAN_LIMIT_BYTES } = fileOperationsSupport;

const {
  abortController,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const { useTempDir } = tempDirKit;

const temp3 = useTempDir(`session-test-`);

const returnsSingleValidSessionFile = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(temp3.path, "session.jsonl");
      yield* writeTextFile(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );
      expect(yield* Effect.promise(() => findMostRecentSession(temp3.path))).toBe(file);
    }),
  );

const returnsMostRecentlyModifiedSession = Effect.gen(function* () {
  const file1 = joinPath(temp3.path, "older.jsonl");
  const file2 = joinPath(temp3.path, "newer.jsonl");

  yield* writeTextFile(
    file1,
    '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  yield* Effect.sleep(10);
  yield* writeTextFile(
    file2,
    '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  expect(yield* Effect.promise(() => findMostRecentSession(temp3.path))).toBe(file2);
});

const skipsInvalidFilesAndReturnsValid = Effect.gen(function* () {
  const invalid = joinPath(temp3.path, "invalid.jsonl");
  const valid = joinPath(temp3.path, "valid.jsonl");

  yield* writeTextFile(invalid, '{"type":"not-session"}\n');
  yield* Effect.sleep(10);
  yield* writeTextFile(
    valid,
    '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  expect(yield* Effect.promise(() => findMostRecentSession(temp3.path))).toBe(valid);
});

const skipsOversizedCorruptFilesAndReturns = () =>
  runTest(
    Effect.gen(function* () {
      const invalid = joinPath(temp3.path, "oversized.jsonl");
      const valid = joinPath(temp3.path, "valid.jsonl");
      yield* writeTextFile(invalid, "x".repeat(HEADER_SCAN_LIMIT_BYTES + 1));
      yield* writeTextFile(
        valid,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );

      expect(yield* Effect.promise(() => findMostRecentSession(temp3.path))).toBe(valid);
    }),
  );

const filtersMostRecentSessionByCwd = Effect.gen(function* () {
  const projectA = joinPath(temp3.path, "project-a");
  const projectB = joinPath(temp3.path, "project-b");
  const fileA = joinPath(temp3.path, "a.jsonl");
  const fileB = joinPath(temp3.path, "b.jsonl");

  yield* writeTextFile(
    fileA,
    `${yield* toJsonText({ cwd: projectA, id: "a", timestamp: "2025-01-01T00:00:00Z", type: "session" })}\n`,
  );
  yield* Effect.sleep(10);
  yield* writeTextFile(
    fileB,
    `${yield* toJsonText({ cwd: projectB, id: "b", timestamp: "2025-01-01T00:00:00Z", type: "session" })}\n`,
  );

  expect(yield* Effect.promise(() => findMostRecentSession(temp3.path, projectA))).toBe(fileA);
  expect(yield* Effect.promise(() => findMostRecentSession(temp3.path, projectB))).toBe(fileB);
});

const returnsNullForEmptyDirectory = () =>
  expect(findMostRecentSession(temp3.path)).resolves.toBeNull();

const returnsNullForNonExistentDirectory = () =>
  expect(findMostRecentSession(joinPath(temp3.path, "nonexistent"))).resolves.toBeNull();

const ignoresNonJsonlFiles = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(temp3.path, "file.txt"), "hello");
      yield* writeTextFile(joinPath(temp3.path, "file.json"), "{}");
      expect(yield* Effect.promise(() => findMostRecentSession(temp3.path))).toBeNull();
    }),
  );

const ignoresJsonlFilesWithoutValidSessionHeader = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(temp3.path, "invalid.jsonl"), '{"type":"message"}\n');
      expect(yield* Effect.promise(() => findMostRecentSession(temp3.path))).toBeNull();
    }),
  );

const returnsMostRecentlyModifiedSession2 = () =>
  Effect.runPromise(returnsMostRecentlyModifiedSession);

const skipsInvalidFilesAndReturnsValidOne = () =>
  Effect.runPromise(skipsInvalidFilesAndReturnsValid);

const filtersMostRecentSessionByCwd2 = () => Effect.runPromise(filtersMostRecentSessionByCwd);

describe("findMostRecentSession", () => {
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

const projectA = () => joinPath(temp3.path, "project-a");

const projectB = () => joinPath(temp3.path, "project-b");

function createPersistedSession(cwd: string, label: string): string {
  const session = SessionManager.create(cwd, temp3.path);
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
  const sessionA = createPersistedSession(projectA(), "from A");
  yield* Effect.sleep(10);
  const sessionB = createPersistedSession(projectB(), "from B");

  const currentA = yield* Effect.promise(() => SessionManager.list(projectA(), temp3.path));
  expect(currentA.map((session) => session.path)).toEqual([sessionA]);

  const all = yield* Effect.promise(() => SessionManager.listAll(temp3.path));
  expect(new Set(all.map((session) => session.path))).toEqual(new Set([sessionA, sessionB]));

  const continuedA = yield* Effect.promise(() =>
    SessionManager.continueRecent(projectA(), temp3.path),
  );
  expect(continuedA.getSessionFile()).toBe(sessionA);
});

const rejectsACancelledSessionListing = Effect.gen(function* () {
  createPersistedSession(projectA(), "from A");
  createPersistedSession(projectB(), "from B");
  const controller = abortController();
  const listing = SessionManager.listAll(
    temp3.path,
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
      yield* makeDirectory(projectA());
      yield* makeDirectory(projectB());
    }),
  );

describe("SessionManager custom flat session directory", () => {
  beforeEach(beforeEachHook3);
  it(
    "scopes current-folder APIs by cwd while listing all flat sessions",
    scopesCurrentFolderApisByCwdWhile,
  );
  it("rejects a cancelled session listing", rejectsACancelledSessionListing2);
});
