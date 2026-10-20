import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { SessionManager } from "../../src/core/session-manager.ts";
import utilities from "../utilities.ts";

const { assistantMsg, readSessionFileRoles, userMsg } = utilities;

const {
  fromJsonText,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir5: string;

const truncatesAndRewritesEmptyFileWith = () =>
  runTest(
    Effect.gen(function* () {
      const emptyFile = joinPath(tempDir5, "empty.jsonl");
      yield* writeTextFile(emptyFile, "");

      const sm = SessionManager.open(emptyFile, tempDir5);

      expect(sm.getSessionId()).toBeTruthy();
      expect(sm.getHeader()).toBeTruthy();
      expect(sm.getHeader()?.type).toBe("session");

      const content = yield* readTextFile(emptyFile);
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      const [headerLine] = lines;
      if (headerLine === undefined) throw new Error("expected a header line");
      const header = (yield* fromJsonText(headerLine)) as { type: string; id: string };
      expect(header.type).toBe("session");
      expect(header.id).toBe(sm.getSessionId());
    }),
  );

const throwsAndPreservesNonEmptyFile = () =>
  runTest(
    Effect.gen(function* () {
      const noHeaderFile = joinPath(tempDir5, "no-header.jsonl");
      const originalContent =
        '{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n';
      yield* writeTextFile(noHeaderFile, originalContent);

      expect(() => SessionManager.open(noHeaderFile, tempDir5)).toThrow(
        `Session file is not a valid msa session: ${noHeaderFile}`,
      );
      expect(yield* readTextFile(noHeaderFile)).toBe(originalContent);
    }),
  );

const throwsAndPreservesNonSessionJsonl = () =>
  runTest(
    Effect.gen(function* () {
      const nonSessionFile = joinPath(tempDir5, "not-a-session.log");
      const originalContent = '{"type":"event","data":"not a session"}\n';
      yield* writeTextFile(nonSessionFile, originalContent);

      expect(() => SessionManager.open(nonSessionFile, tempDir5)).toThrow(
        `Session file is not a valid msa session: ${nonSessionFile}`,
      );
      expect(yield* readTextFile(nonSessionFile)).toBe(originalContent);
    }),
  );

const preservesExplicitSessionFilePathWhen = () =>
  runTest(
    Effect.gen(function* () {
      const explicitPath = joinPath(tempDir5, "my-session.jsonl");
      yield* writeTextFile(explicitPath, "");

      const sm = SessionManager.open(explicitPath, tempDir5);

      expect(sm.getSessionFile()).toBe(explicitPath);
    }),
  );

const subsequentLoadsOfInitializedEmptyFile = () =>
  runTest(
    Effect.gen(function* () {
      const emptyFile = joinPath(tempDir5, "empty.jsonl");
      yield* writeTextFile(emptyFile, "");

      const sm1 = SessionManager.open(emptyFile, tempDir5);
      const sessionId = sm1.getSessionId();

      const sm2 = SessionManager.open(emptyFile, tempDir5);
      expect(sm2.getSessionId()).toBe(sessionId);
      expect(sm2.getHeader()?.type).toBe("session");
    }),
  );

const beforeEachHook4 = () =>
  runTest(
    Effect.gen(function* () {
      tempDir5 = yield* makeTempDir(`session-test-`);
      yield* makeDirectory(tempDir5);
    }),
  );

describe("SessionManager.setSessionFile with corrupted files", () => {
  beforeEach(beforeEachHook4);
  afterEach(() => runTest(removePath(tempDir5)));
  it("truncates and rewrites empty file with valid header", truncatesAndRewritesEmptyFileWith);
  it("throws and preserves non-empty file without valid header", throwsAndPreservesNonEmptyFile);
  it("throws and preserves non-session JSONL files", throwsAndPreservesNonSessionJsonl);
  it(
    "preserves explicit session file path when recovering from corrupted file",
    preservesExplicitSessionFilePathWhen,
  );
  it(
    "subsequent loads of initialized empty file work correctly",
    subsequentLoadsOfInitializedEmptyFile,
  );
});

let tempDir6: string;

const doesNotCreateAFileFor = () =>
  runTest(
    Effect.gen(function* () {
      const session = SessionManager.create(tempDir6, tempDir6);
      session.appendModelChange("anthropic-api", "claude-sonnet-4-5");
      session.appendThinkingLevelChange("off");

      expect(yield* pathExists(session.getSessionFile()!)).toBe(false);
    }),
  );

const createsTheFileWhenTheFirst = () =>
  runTest(
    Effect.gen(function* () {
      const session = SessionManager.create(tempDir6, tempDir6);
      session.appendModelChange("anthropic-api", "claude-sonnet-4-5");
      session.appendMessage(userMsg("first question"));

      const file = session.getSessionFile()!;
      expect(yield* Effect.promise(() => readSessionFileRoles(file))).toEqual([
        "session",
        "model_change",
        "user",
      ]);
      expect(SessionManager.open(file, tempDir6).buildSessionContext().messages).toHaveLength(1);
    }),
  );

const appendsLaterEntriesToTheFile = () =>
  runTest(
    Effect.gen(function* () {
      const session = SessionManager.create(tempDir6, tempDir6);
      session.appendMessage(userMsg("first question"));
      session.appendCustomEntry("preset-state", { name: "plan" });
      session.appendMessage(assistantMsg("first answer"));

      expect(yield* Effect.promise(() => readSessionFileRoles(session.getSessionFile()!))).toEqual([
        "session",
        "user",
        "custom",
        "assistant",
      ]);
    }),
  );

const beforeEachHook5 = () =>
  runTest(
    Effect.gen(function* () {
      const value = (tempDir6 = yield* makeTempDir("msa-session-persist-"));
      return value;
    }),
  );

describe("SessionManager session file creation", () => {
  beforeEach(beforeEachHook5);
  afterEach(() => runTest(removePath(tempDir6)));
  it("does not create a file for a session with only setup entries", doesNotCreateAFileFor);
  it("creates the file when the first user message is appended", createsTheFileWhenTheFirst);
  it(
    "appends later entries to the file without rewriting earlier ones",
    appendsLaterEntriesToTheFile,
  );
});
