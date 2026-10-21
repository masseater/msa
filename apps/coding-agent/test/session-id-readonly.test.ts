import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type argsTypes from "../src/cli/args.types.ts";
import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import sessionOpen from "../src/main/session-open.ts";
import cliProcess from "./cli-process.ts";
const { createSessionManager } = sessionOpen;

const {
  awaited,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  readDirectoryRecursive,
  readTextFile,
  realPath,
  removeDirs,
  renamePath,
  runTest,
} = testing;

const { runCli } = cliProcess;

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  return runTest(removeDirs(tempDirs.splice(0)));
});

const createTempDir = Effect.fn("createTempDir")(function* () {
  const dir = yield* realPath(yield* makeTempDir("msa-session-id-readonly-"));
  tempDirs.push(dir);
  return dir;
});

const sessionIdOf = Effect.fn("sessionIdOf")(function* (path: string) {
  const firstLine = (yield* readTextFile(path)).split("\n", 1)[0] ?? "";
  const header = (yield* fromJsonText(firstLine).pipe(
    Effect.catchDefect(() => Effect.succeed({})),
  )) as { type?: string; id?: string };
  return header.type === "session" ? header.id : undefined;
});

const hasSessionWithId = Effect.fn("hasSessionWithId")(function* (root: string, sessionId: string) {
  if (!(yield* pathExists(root))) return false;
  const files = (yield* readDirectoryRecursive(root)).filter((entry) => entry.endsWith(".jsonl"));
  const ids = yield* Effect.forEach(files, (file) => sessionIdOf(joinPath(root, file)));
  return ids.includes(sessionId);
});

const runReadOnlyHelp = Effect.fn("runReadOnlyHelp")(function* () {
  const tempRoot = yield* createTempDir();
  const agentDir = joinPath(tempRoot, "agent");
  const projectDir = joinPath(tempRoot, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(projectDir);
  const { code } = yield* awaited(
    runCli(["--session-id", "read-only-help", "--help"], { agentDir, cwd: projectDir }),
  );
  return { agentDir, code };
});

function args(overrides: Partial<argsTypes.Args>): argsTypes.Args {
  return {
    diagnostics: [],
    fileArgs: [],
    messages: [],
    unknownFlags: new Map(),
    ...overrides,
  };
}

function persistSession(session: sessionManagerTypes.SessionManager, content: string): void {
  session.appendMessage({ content, role: "user", timestamp: currentTimeMillis() });
  session.appendMessage({
    api: "anthropic-messages" as const,
    content: [{ text: "persisted", type: "text" as const }],
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
}

const doesNotPersistACustomIdFor = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* runReadOnlyHelp();
      expect(result.code).toBe(0);
      expect(yield* hasSessionWithId(joinPath(result.agentDir, "sessions"), "read-only-help")).toBe(
        false,
      );
    }),
  );

const createsMissingIdsAndReopensExistingIds = () =>
  runTest(
    Effect.gen(function* () {
      const tempRoot = yield* createTempDir();
      const projectDir = joinPath(tempRoot, "project");
      const sessionDir = joinPath(tempRoot, "sessions");
      yield* makeDirectory(projectDir);
      const settingsManager = SettingsManager.inMemory();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const readOnly = yield* awaited(
        createSessionManager(
          args({ help: true, sessionId: "read-only" }),
          projectDir,
          sessionDir,
          settingsManager,
        ),
      );
      expect(readOnly.getSessionId()).toBe("read-only");
      expect(readOnly.getSessionFile()).toBeUndefined();

      const created = yield* awaited(
        createSessionManager(
          args({ sessionId: "persisted-id" }),
          projectDir,
          sessionDir,
          settingsManager,
        ),
      );
      persistSession(created, "persist me");
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("creating a new session"));

      consoleError.mockClear();
      const reopened = yield* awaited(
        createSessionManager(
          args({ sessionId: "persisted-id" }),
          projectDir,
          sessionDir,
          settingsManager,
        ),
      );
      expect(reopened.getSessionFile()).toBe(created.getSessionFile());
      expect(consoleError).not.toHaveBeenCalled();
    }),
  );

const looksUpExactIdsWithoutBuildingFull = () =>
  runTest(
    Effect.gen(function* () {
      const tempRoot = yield* createTempDir();
      const projectDir = joinPath(tempRoot, "project");
      const sessionDir = joinPath(tempRoot, "sessions");
      yield* makeDirectory(projectDir);
      const unrelated = SessionManager.create(projectDir, sessionDir, { id: "unrelated-id" });
      persistSession(unrelated, "large transcript contents must not be loaded");
      const list = vi
        .spyOn(SessionManager, "list")
        .mockRejectedValue(new Error("unexpected full listing"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const created = yield* awaited(
        createSessionManager(
          args({ sessionId: "fresh-id" }),
          projectDir,
          sessionDir,
          SettingsManager.inMemory(),
        ),
      );

      expect(created.getSessionId()).toBe("fresh-id");
      expect(list).not.toHaveBeenCalled();
    }),
  );

const reopensAnExactIdFromARenamed = () =>
  runTest(
    Effect.gen(function* () {
      const tempRoot = yield* createTempDir();
      const projectDir = joinPath(tempRoot, "project");
      const sessionDir = joinPath(tempRoot, "sessions");
      yield* makeDirectory(projectDir);
      const original = SessionManager.create(projectDir, sessionDir, { id: "renamed-id" });
      persistSession(original, "persist me");
      const renamedPath = joinPath(sessionDir, "imported-session.jsonl");
      yield* renamePath(original.getSessionFile() ?? "", renamedPath);

      const reopened = yield* awaited(
        createSessionManager(
          args({ sessionId: "renamed-id" }),
          projectDir,
          sessionDir,
          SettingsManager.inMemory(),
        ),
      );

      expect(reopened.getSessionFile()).toBe(renamedPath);
    }),
  );

const filtersExactIdsByCwdInA = () =>
  runTest(
    Effect.gen(function* () {
      const tempRoot = yield* createTempDir();
      const projectA = joinPath(tempRoot, "project-a");
      const projectB = joinPath(tempRoot, "project-b");
      const sessionDir = joinPath(tempRoot, "sessions");
      yield* makeDirectory(projectA);
      yield* makeDirectory(projectB);
      const foreign = SessionManager.create(projectB, sessionDir, { id: "foreign-id" });
      persistSession(foreign, "foreign session");

      expect(SessionManager.findById(projectA, "foreign-id", sessionDir)).toBeUndefined();
      expect(SessionManager.findById(projectB, "foreign-id", sessionDir)).toBe(
        foreign.getSessionFile(),
      );
    }),
  );

const rejectsAnExistingForkTargetInProcess = () =>
  runTest(
    Effect.gen(function* () {
      const tempRoot = yield* createTempDir();
      const projectDir = joinPath(tempRoot, "project");
      const sessionDir = joinPath(tempRoot, "sessions");
      yield* makeDirectory(projectDir);
      const source = SessionManager.create(projectDir, sessionDir, { id: "source-id" });
      persistSession(source, "source");
      const target = SessionManager.create(projectDir, sessionDir, { id: "existing-id" });
      persistSession(target, "target");
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`exit:${code}`);
      });

      yield* awaited(
        expect(
          createSessionManager(
            args({ fork: "source-id", sessionId: "existing-id" }),
            projectDir,
            sessionDir,
            SettingsManager.inMemory(),
          ),
        ).rejects.toThrow("exit:1"),
      );
    }),
  );

describe("--session-id", () => {
  it("does not persist a custom ID for metadata commands", doesNotPersistACustomIdFor);

  it(
    "creates missing IDs and reopens existing IDs in process",
    createsMissingIdsAndReopensExistingIds,
  );

  it(
    "looks up exact IDs without building full session listings",
    looksUpExactIdsWithoutBuildingFull,
  );

  it("reopens an exact ID from a renamed session file", reopensAnExactIdFromARenamed);

  it("filters exact IDs by cwd in a custom session directory", filtersExactIdsByCwdInA);

  it("rejects an existing fork target in process", rejectsAnExistingForkTargetInProcess);
});
