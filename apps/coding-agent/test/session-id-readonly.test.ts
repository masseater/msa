import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  awaited,
  runTest,
  currentTimeMillis,
  makeDirectory,
  joinPath,
  resolvePath,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Args } from "../src/cli/args.ts";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { envSnapshot } from "../src/core/process-env.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSessionManager } from "../src/main.ts";

const cliPath = resolvePath(__dirname, "../src/cli.ts");

const sourceResolverUrl = pathToFileURL(
  resolvePath(__dirname, "../src/experimental/source-resolver.ts"),
).href;
const tempDirs: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      vi.restoreAllMocks();
      for (const dir of tempDirs.splice(0)) {
        yield* removePath(dir);
      }
    }),
  ),
);

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(joinPath(tmpdir(), "msa-session-id-readonly-")));
  tempDirs.push(dir);
  return dir;
}

function hasSessionWithId(root: string, sessionId: string): boolean {
  if (!existsSync(root)) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = joinPath(root, entry.name);
    if (entry.isDirectory() && hasSessionWithId(path, sessionId)) return true;
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

    try {
      const firstLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
      const header = JSON.parse(firstLine) as { type?: string; id?: string };
      if (header.type === "session" && header.id === sessionId) return true;
    } catch {}
  }
  return false;
}

function runCli(args: string[]): Promise<{ code: number | null; agentDir: string }> {
  return runTest(
    Effect.gen(function* () {
      const tempRoot = createTempDir();
      const agentDir = joinPath(tempRoot, "agent");
      const projectDir = joinPath(tempRoot, "project");
      yield* makeDirectory(agentDir);
      yield* makeDirectory(projectDir);

      const code = yield* awaited(
        new Promise<number | null>((resolvePromise, reject) => {
          const child = spawn(process.execPath, ["--import", sourceResolverUrl, cliPath, ...args], {
            cwd: projectDir,
            env: {
              ...envSnapshot(),
              [ENV_AGENT_DIR]: agentDir,
              MSA_OFFLINE: "1",
            },
            stdio: ["ignore", "ignore", "ignore"],
          });
          child.on("error", reject);
          child.on("close", resolvePromise);
        }),
      );

      return yield* awaited({ code, agentDir });
    }),
  );
}

function args(overrides: Partial<Args>): Args {
  return {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
    ...overrides,
  };
}

function persistSession(session: SessionManager, content: string): void {
  session.appendMessage({ role: "user", content, timestamp: currentTimeMillis() });
  session.appendMessage({
    role: "assistant",
    content: [{ type: "text" as const, text: "persisted" }],
    api: "anthropic-messages" as const,
    provider: "anthropic",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: currentTimeMillis(),
  });
}

describe("--session-id", () => {
  it("does not persist a custom ID for metadata commands", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(runCli(["--session-id", "read-only-help", "--help"]));

        expect(result.code).toBe(0);
        expect(hasSessionWithId(joinPath(result.agentDir, "sessions"), "read-only-help")).toBe(
          false,
        );
      }),
    ));

  it("creates missing IDs and reopens existing IDs in process", () =>
    runTest(
      Effect.gen(function* () {
        const tempRoot = createTempDir();
        const projectDir = joinPath(tempRoot, "project");
        const sessionDir = joinPath(tempRoot, "sessions");
        yield* makeDirectory(projectDir);
        const settingsManager = SettingsManager.inMemory();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const readOnly = yield* awaited(
          createSessionManager(
            args({ sessionId: "read-only", help: true }),
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
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining("creating a new session"),
        );

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
    ));

  it("looks up exact IDs without building full session listings", () =>
    runTest(
      Effect.gen(function* () {
        const tempRoot = createTempDir();
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
    ));

  it("reopens an exact ID from a renamed session file", () =>
    runTest(
      Effect.gen(function* () {
        const tempRoot = createTempDir();
        const projectDir = joinPath(tempRoot, "project");
        const sessionDir = joinPath(tempRoot, "sessions");
        yield* makeDirectory(projectDir);
        const original = SessionManager.create(projectDir, sessionDir, { id: "renamed-id" });
        persistSession(original, "persist me");
        const renamedPath = joinPath(sessionDir, "imported-session.jsonl");
        renameSync(original.getSessionFile()!, renamedPath);

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
    ));

  it("filters exact IDs by cwd in a custom session directory", () => {
    const tempRoot = createTempDir();
    const projectA = joinPath(tempRoot, "project-a");
    const projectB = joinPath(tempRoot, "project-b");
    const sessionDir = joinPath(tempRoot, "sessions");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    const foreign = SessionManager.create(projectB, sessionDir, { id: "foreign-id" });
    persistSession(foreign, "foreign session");

    expect(SessionManager.findById(projectA, "foreign-id", sessionDir)).toBeUndefined();
    expect(SessionManager.findById(projectB, "foreign-id", sessionDir)).toBe(
      foreign.getSessionFile(),
    );
  });

  it("rejects an existing fork target in process", () =>
    runTest(
      Effect.gen(function* () {
        const tempRoot = createTempDir();
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
    ));
});
