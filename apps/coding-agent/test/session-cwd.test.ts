import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionRuntimeSupport from "../src/core/agent-session-runtime-support.ts";
import type agentSessionRuntimeTypes from "../src/core/agent-session-runtime.types.ts";
import MissingSessionCwdError from "../src/core/missing-session-cwd-error.ts";
import sessionCwdModule from "../src/core/session-cwd.ts";
import SessionManager from "../src/core/session-manager.ts";

const { getMissingSessionCwdIssue } = sessionCwdModule;
const { createAgentSessionRuntime } = agentSessionRuntimeSupport;

const { awaited, currentDate, joinPath, runTest, trackedTempDirs, toJsonText, writeTextFile } =
  testing;

const { cleanUp, make: createTempDir } = trackedTempDirs();

const writeSessionFile = (path: string, cwd: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const text = yield* toJsonText({
      cwd,
      id: "session-id",
      timestamp: currentDate().toISOString(),
      type: "session" as const,
      version: 3,
    });
    yield* writeTextFile(path, `${text}\n`);
  });

const detectsMissingSessionCwdFromPersistedSessions = () =>
  runTest(
    Effect.gen(function* () {
      const fallbackCwd = yield* createTempDir("msa-session-cwd-fallback-");
      const missingCwd = joinPath(fallbackCwd, "does-not-exist");
      const sessionDir = yield* createTempDir("msa-session-cwd-session-dir-");
      const sessionFile = joinPath(sessionDir, "session.jsonl");
      yield* writeSessionFile(sessionFile, missingCwd);

      const sessionManager = yield* Effect.promise(() => SessionManager.open(sessionFile));
      const issue = yield* Effect.promise(() =>
        getMissingSessionCwdIssue(sessionManager, fallbackCwd),
      );
      expect(issue).toEqual({
        fallbackCwd,
        sessionCwd: missingCwd,
        sessionFile: sessionManager.getSessionFile(),
      });
    }),
  );

const supportsOverridingTheEffectiveCwdWhenOpening = () =>
  runTest(
    Effect.gen(function* () {
      const fallbackCwd = yield* createTempDir("msa-session-cwd-override-");
      const missingCwd = joinPath(fallbackCwd, "does-not-exist");
      const sessionDir = yield* createTempDir("msa-session-cwd-override-session-dir-");
      const sessionFile = joinPath(sessionDir, "session.jsonl");
      yield* writeSessionFile(sessionFile, missingCwd);

      const sessionManager = yield* Effect.promise(() =>
        SessionManager.open(sessionFile, undefined, fallbackCwd),
      );
      expect(sessionManager.getCwd()).toBe(fallbackCwd);
      expect(
        yield* Effect.promise(() => getMissingSessionCwdIssue(sessionManager, fallbackCwd)),
      ).toBeUndefined();
    }),
  );

const throwsAControlledErrorBeforeRuntimeCreation = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const fallbackCwd = yield* createTempDir("msa-session-cwd-runtime-");
      const missingCwd = joinPath(fallbackCwd, "does-not-exist");
      const sessionDir = yield* createTempDir("msa-session-cwd-runtime-session-dir-");
      const sessionFile = joinPath(sessionDir, "session.jsonl");
      yield* writeSessionFile(sessionFile, missingCwd);

      const sessionManager = yield* Effect.promise(() => SessionManager.open(sessionFile));
      let createRuntimeCalled = false;
      const createRuntime: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory = () =>
        effectRunPromise(
          Effect.sync(() => {
            createRuntimeCalled = true;
            throw new Error("should not be called");
          }),
        );

      yield* awaited(
        expect(
          createAgentSessionRuntime(createRuntime, {
            agentDir: fallbackCwd,
            cwd: fallbackCwd,
            sessionManager,
          }),
        ).rejects.toBeInstanceOf(MissingSessionCwdError),
      );
      expect(createRuntimeCalled).toBe(false);
    }),
  );

describe("session cwd handling", () => {
  afterEach(() => runTest(cleanUp));

  it(
    "detects missing session cwd from persisted sessions",
    detectsMissingSessionCwdFromPersistedSessions,
  );

  it(
    "supports overriding the effective cwd when opening a session",
    supportsOverridingTheEffectiveCwdWhenOpening,
  );

  it(
    "throws a controlled error before runtime creation when the stored cwd is missing",
    throwsAControlledErrorBeforeRuntimeCreation,
  );
});
