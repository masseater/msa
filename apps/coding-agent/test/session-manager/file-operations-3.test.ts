import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import tempDirKit from "../temp-dir.ts";
import utilities from "../utilities.ts";
const { assistantMsg, readSessionFileRoles, userMsg } = utilities;

const { fromJsonText, joinPath, pathExists, readTextFile, awaited, runTest, writeTextFile } =
  testing;

const { useTempDir } = tempDirKit;

const temp5 = useTempDir(`session-test-`);

const truncatesAndRewritesEmptyFileWith = () =>
  runTest(
    Effect.gen(function* () {
      const emptyFile = joinPath(temp5.path, "empty.jsonl");
      yield* writeTextFile(emptyFile, "");

      const sm = yield* Effect.promise(() => SessionManager.open(emptyFile, temp5.path));

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
      const noHeaderFile = joinPath(temp5.path, "no-header.jsonl");
      const originalContent =
        '{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n';
      yield* writeTextFile(noHeaderFile, originalContent);

      yield* awaited(
        expect(SessionManager.open(noHeaderFile, temp5.path)).rejects.toThrow(
          `Session file is not a valid msa session: ${noHeaderFile}`,
        ),
      );
      expect(yield* readTextFile(noHeaderFile)).toBe(originalContent);
    }),
  );

const throwsAndPreservesNonSessionJsonl = () =>
  runTest(
    Effect.gen(function* () {
      const nonSessionFile = joinPath(temp5.path, "not-a-session.log");
      const originalContent = '{"type":"event","data":"not a session"}\n';
      yield* writeTextFile(nonSessionFile, originalContent);

      yield* awaited(
        expect(SessionManager.open(nonSessionFile, temp5.path)).rejects.toThrow(
          `Session file is not a valid msa session: ${nonSessionFile}`,
        ),
      );
      expect(yield* readTextFile(nonSessionFile)).toBe(originalContent);
    }),
  );

const preservesExplicitSessionFilePathWhen = () =>
  runTest(
    Effect.gen(function* () {
      const explicitPath = joinPath(temp5.path, "my-session.jsonl");
      yield* writeTextFile(explicitPath, "");

      const sm = yield* Effect.promise(() => SessionManager.open(explicitPath, temp5.path));

      expect(sm.getSessionFile()).toBe(explicitPath);
    }),
  );

const subsequentLoadsOfInitializedEmptyFile = () =>
  runTest(
    Effect.gen(function* () {
      const emptyFile = joinPath(temp5.path, "empty.jsonl");
      yield* writeTextFile(emptyFile, "");

      const sm1 = yield* Effect.promise(() => SessionManager.open(emptyFile, temp5.path));
      const sessionId = sm1.getSessionId();

      const sm2 = yield* Effect.promise(() => SessionManager.open(emptyFile, temp5.path));
      expect(sm2.getSessionId()).toBe(sessionId);
      expect(sm2.getHeader()?.type).toBe("session");
    }),
  );

describe("SessionManager.setSessionFile with corrupted files", () => {
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

const temp6 = useTempDir("msa-session-persist-");

const doesNotCreateAFileFor = () =>
  runTest(
    Effect.gen(function* () {
      const session = SessionManager.create(temp6.path, temp6.path);
      session.appendModelChange("anthropic-api", "claude-sonnet-4-5");
      session.appendThinkingLevelChange("off");

      expect(yield* pathExists(session.getSessionFile()!)).toBe(false);
    }),
  );

const createsTheFileWhenTheFirst = () =>
  runTest(
    Effect.gen(function* () {
      const session = SessionManager.create(temp6.path, temp6.path);
      session.appendModelChange("anthropic-api", "claude-sonnet-4-5");
      session.appendMessage(userMsg("first question"));

      const file = session.getSessionFile()!;
      expect(yield* Effect.promise(() => readSessionFileRoles(file))).toEqual([
        "session",
        "model_change",
        "user",
      ]);
      expect(
        (yield* Effect.promise(() => SessionManager.open(file, temp6.path))).buildSessionContext()
          .messages,
      ).toHaveLength(1);
    }),
  );

const appendsLaterEntriesToTheFile = () =>
  runTest(
    Effect.gen(function* () {
      const session = SessionManager.create(temp6.path, temp6.path);
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

describe("SessionManager session file creation", () => {
  it("does not create a file for a session with only setup entries", doesNotCreateAFileFor);
  it("creates the file when the first user message is appended", createsTheFileWhenTheFirst);
  it(
    "appends later entries to the file without rewriting earlier ones",
    appendsLaterEntriesToTheFile,
  );
});
