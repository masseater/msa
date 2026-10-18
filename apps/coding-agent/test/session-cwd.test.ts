import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  awaited,
  runTest,
  currentTimeMillis,
  currentDate,
  randomSuffixSync,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionRuntime,
} from "../src/core/agent-session-runtime.ts";
import { getMissingSessionCwdIssue, MissingSessionCwdError } from "../src/core/session-cwd.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function createTempDir(name: string): string {
  const dir = joinPath(tmpdir(), `${name}-${currentTimeMillis()}-${randomSuffixSync()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSessionFile(path: string, cwd: string): void {
  writeFileSync(
    path,
    `${JSON.stringify({
      type: "session" as const,
      version: 3,
      id: "session-id",
      timestamp: currentDate().toISOString(),
      cwd,
    })}\n`,
  );
}

describe("session cwd handling", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("detects missing session cwd from persisted sessions", () => {
    const fallbackCwd = createTempDir("msa-session-cwd-fallback");
    const missingCwd = joinPath(fallbackCwd, "does-not-exist");
    const sessionDir = createTempDir("msa-session-cwd-session-dir");
    const sessionFile = joinPath(sessionDir, "session.jsonl");
    cleanupPaths.push(fallbackCwd, sessionDir);
    writeSessionFile(sessionFile, missingCwd);

    const sessionManager = SessionManager.open(sessionFile);
    const issue = getMissingSessionCwdIssue(sessionManager, fallbackCwd);
    expect(issue).toEqual({
      sessionFile: sessionManager.getSessionFile(),
      sessionCwd: missingCwd,
      fallbackCwd,
    });
  });

  it("supports overriding the effective cwd when opening a session", () => {
    const fallbackCwd = createTempDir("msa-session-cwd-override");
    const missingCwd = joinPath(fallbackCwd, "does-not-exist");
    const sessionDir = createTempDir("msa-session-cwd-override-session-dir");
    const sessionFile = joinPath(sessionDir, "session.jsonl");
    cleanupPaths.push(fallbackCwd, sessionDir);
    writeSessionFile(sessionFile, missingCwd);

    const sessionManager = SessionManager.open(sessionFile, undefined, fallbackCwd);
    expect(sessionManager.getCwd()).toBe(fallbackCwd);
    expect(getMissingSessionCwdIssue(sessionManager, fallbackCwd)).toBeUndefined();
  });

  it("throws a controlled error before runtime creation when the stored cwd is missing", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const fallbackCwd = createTempDir("msa-session-cwd-runtime");
        const missingCwd = joinPath(fallbackCwd, "does-not-exist");
        const sessionDir = createTempDir("msa-session-cwd-runtime-session-dir");
        const sessionFile = joinPath(sessionDir, "session.jsonl");
        cleanupPaths.push(fallbackCwd, sessionDir);
        writeSessionFile(sessionFile, missingCwd);

        const sessionManager = SessionManager.open(sessionFile);
        let createRuntimeCalled = false;
        const createRuntime: CreateAgentSessionRuntimeFactory = () =>
          effectRunPromise(
            Effect.sync(() => {
              createRuntimeCalled = true;
              throw new Error("should not be called");
            }),
          );

        yield* awaited(
          expect(
            createAgentSessionRuntime(createRuntime, {
              cwd: fallbackCwd,
              agentDir: fallbackCwd,
              sessionManager,
            }),
          ).rejects.toBeInstanceOf(MissingSessionCwdError),
        );
        expect(createRuntimeCalled).toBe(false);
      }),
    ));
});
