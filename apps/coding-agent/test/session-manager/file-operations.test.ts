import { constants as bufferConstants } from "buffer";

import testing from "@msa/testing";
import { Effect, FileSystem } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import sessionFiles from "../../src/core/session-manager/session-files.ts";
import fileOperationsSupport from "./file-operations-support.ts";

const { loadEntriesFromFile } = sessionFiles;

const { HEADER_SCAN_LIMIT_BYTES } = fileOperationsSupport;

const {
  appendTextFile,
  joinPath,
  makeDirectory,
  makeTempDir,
  provideNode,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

function writeSessionHeader(file: string, cwd: string, id: string, prefix = "") {
  return runTest(
    writeTextFile(
      file,
      `${prefix}${JSON.stringify({
        cwd,
        id,
        timestamp: "2025-01-01T00:00:00Z",
        type: "session",
        version: 3,
      })}\n`,
    ),
  );
}

const loadsValidSessionFile = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "valid.jsonl");
      yield* writeTextFile(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
          '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
      );
      const entries = loadEntriesFromFile(file);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.type).toBe("session");
      expect(entries[1]?.type).toBe("message");
    }),
  );

const skipsMalformedLinesButKeepsValid = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "mixed.jsonl");
      yield* writeTextFile(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
          "not valid json\n" +
          '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
      );
      const entries = loadEntriesFromFile(file);
      expect(entries).toHaveLength(2);
    }),
  );

const addsANewlineAfterAnUnterminated = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "unterminated.jsonl");
      const content =
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
        '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}';
      yield* writeTextFile(file, content);

      expect(loadEntriesFromFile(file)).toHaveLength(2);
      expect(yield* readTextFile(file)).toBe(`${content}\n`);
    }),
  );

const addsANewlineAfterAnUnterminated2 = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "malformed-tail.jsonl");
      const content =
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
        '{"type":"message"';
      yield* writeTextFile(file, content);

      expect(loadEntriesFromFile(file)).toHaveLength(1);
      expect(yield* readTextFile(file)).toBe(`${content}\n`);
    }),
  );

const doesNotModifyAnUnterminatedNon = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "invalid.jsonl");
      const content = '{"type":"message","id":"1"}';
      yield* writeTextFile(file, content);

      expect(loadEntriesFromFile(file)).toEqual([]);
      expect(yield* readTextFile(file)).toBe(content);
    }),
  );

const opensCompatibleSessionsBeyondTheDiscovery = () =>
  runTest(
    Effect.gen(function* () {
      const storedCwd = joinPath(tempDir, "stored-project");
      const overrideCwd = joinPath(tempDir, "override-project");
      const cases = [
        { id: "a".repeat(HEADER_SCAN_LIMIT_BYTES + 1), name: "large-header", prefix: "" },
        {
          id: "large-prefix",
          name: "large-prefix",
          prefix: `${"x".repeat(HEADER_SCAN_LIMIT_BYTES + 1)}\n`,
        },
      ];

      for (const { name, id, prefix } of cases) {
        const file = joinPath(tempDir, `${name}.jsonl`);
        yield* Effect.promise(() => writeSessionHeader(file, storedCwd, id, prefix));
        for (const cwdOverride of [undefined, overrideCwd]) {
          const sessionManager = SessionManager.open(file, tempDir, cwdOverride);
          expect(sessionManager.getSessionId()).toBe(id);
          expect(sessionManager.getCwd()).toBe(cwdOverride ?? storedCwd);
        }
      }
    }),
  );

const opensSessionFilesLargerThanNode = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "large.jsonl");
      yield* writeTextFile(
        file,
        '{"type":"session","version":3,"id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );

      const newline = Buffer.from("\n");
      const stride = 16 * 1024 * 1024;
      yield* provideNode(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* (yield* FileSystem.FileSystem).open(file, { flag: "r+" });
            for (
              let offset = stride;
              offset <= bufferConstants.MAX_STRING_LENGTH + stride;
              offset += stride
            ) {
              yield* handle.seek(BigInt(offset), "start");
              yield* handle.write(newline);
            }
          }),
        ),
      );

      yield* appendTextFile(
        file,
        '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
      );

      const sessionManager = SessionManager.open(file, tempDir);
      expect(sessionManager.getSessionId()).toBe("abc");
      expect(sessionManager.getEntries()).toHaveLength(1);
      expect(sessionManager.buildSessionContext().messages).toEqual([
        { content: "hi", role: "user", timestamp: 1 },
      ]);
    }),
  );

const returnsEmptyArrayForNonExistentFile = () => {
  const entries = loadEntriesFromFile(joinPath(tempDir, "nonexistent.jsonl"));
  expect(entries).toEqual([]);
};

const returnsEmptyArrayForEmptyFile = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "empty.jsonl");
      yield* writeTextFile(file, "");
      expect(loadEntriesFromFile(file)).toEqual([]);
    }),
  );

const returnsEmptyArrayForFileWithoutValid = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "no-header.jsonl");
      yield* writeTextFile(file, '{"type":"message","id":"1"}\n');
      expect(loadEntriesFromFile(file)).toEqual([]);
    }),
  );

const returnsEmptyArrayForMalformedJson = () =>
  runTest(
    Effect.gen(function* () {
      const file = joinPath(tempDir, "malformed.jsonl");
      yield* writeTextFile(file, "not json\n");
      expect(loadEntriesFromFile(file)).toEqual([]);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir(`session-test-`);
      yield* makeDirectory(tempDir);
    }),
  );

describe("loadEntriesFromFile", () => {
  beforeEach(beforeEachHook);
  afterEach(() => runTest(removePath(tempDir)));
  it("returns empty array for non-existent file", returnsEmptyArrayForNonExistentFile);
  it("returns empty array for empty file", returnsEmptyArrayForEmptyFile);
  it(
    "returns empty array for file without valid session header",
    returnsEmptyArrayForFileWithoutValid,
  );
  it("returns empty array for malformed JSON", returnsEmptyArrayForMalformedJson);
  it("loads valid session file", loadsValidSessionFile);
  it("skips malformed lines but keeps valid ones", skipsMalformedLinesButKeepsValid);
  it("adds a newline after an unterminated valid record", addsANewlineAfterAnUnterminated);
  it(
    "adds a newline after an unterminated malformed final fragment",
    addsANewlineAfterAnUnterminated2,
  );
  it("does not modify an unterminated non-session file", doesNotModifyAnUnterminatedNon);
  it.each([
    ["leading blank lines", "\n  \n", "leading-blank"],
    ["leading malformed lines", "not json\n{broken json\n", "leading-malformed"],
    ["a multi-buffer header", "", "a".repeat(8192)],
  ])("reads cwd from a session with %s", (_description, prefix, sessionId) =>
    runTest(
      Effect.gen(function* () {
        const file = joinPath(tempDir, "header.jsonl");
        const storedCwd = joinPath(tempDir, "stored-project");
        yield* Effect.promise(() => writeSessionHeader(file, storedCwd, sessionId, prefix));

        const sessionManager = SessionManager.open(file, tempDir);
        expect(sessionManager.getSessionId()).toBe(sessionId);
        expect(sessionManager.getCwd()).toBe(storedCwd);
      }),
    ),
  );
  it(
    "opens compatible sessions beyond the discovery scan limit",
    opensCompatibleSessionsBeyondTheDiscovery,
  );
  it("opens session files larger than Node's max string length", opensSessionFilesLargerThanNode);
});
