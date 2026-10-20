import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import config from "../src/config.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import interactiveModeSupport from "../src/modes/interactive/interactive-mode-support.ts";

const { formatResumeCommand } = interactiveModeSupport;
const { APP_NAME } = config;

const { joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

const tempDirs: string[] = [];
const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      if (originalStdoutIsTTY === undefined) {
        Reflect.deleteProperty(process.stdout, "isTTY");
      } else {
        Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
      }
      for (const dir of tempDirs.splice(0)) {
        yield* removePath(dir);
      }
    }),
  ),
);

function setStdoutIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

const createTempFile: Effect.Effect<string> = Effect.gen(function* () {
  const dir = yield* makeTempDir("msa-format-resume-command-");
  tempDirs.push(dir);
  const file = joinPath(dir, "session.jsonl");
  yield* writeTextFile(file, "\n");
  return file;
});

function createSessionManager(options: {
  persisted?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionDir?: string;
  usesDefaultSessionDir?: boolean;
}): sessionManagerTypes.SessionManager {
  return {
    getSessionDir: () => options.sessionDir ?? "/tmp/msa-sessions",
    getSessionFile: () => options.sessionFile,
    getSessionId: () => options.sessionId ?? "0197f6e4-4cf9-7f44-a2d8-f8f7f49ee9d3",
    isPersisted: () => options.persisted ?? true,
    usesDefaultSessionDir: () => options.usesDefaultSessionDir ?? true,
  } as unknown as sessionManagerTypes.SessionManager;
}

const returnsASessionResumeCommandForDefault = () =>
  runTest(
    Effect.gen(function* () {
      setStdoutIsTTY(true);
      const sessionFile = yield* createTempFile;
      const sessionManager = createSessionManager({ sessionFile, sessionId: "test-session" });
      expect(formatResumeCommand(sessionManager)).toBe(`${APP_NAME} --session test-session`);
    }),
  );

const includesUnquotedSafeSessionDirsForNon = () =>
  runTest(
    Effect.gen(function* () {
      setStdoutIsTTY(true);
      const sessionFile = yield* createTempFile;
      const sessionManager = createSessionManager({
        sessionDir: "/tmp/custom-msa-sessions",
        sessionFile,
        sessionId: "test-session",
        usesDefaultSessionDir: false,
      });
      expect(formatResumeCommand(sessionManager)).toBe(
        `${APP_NAME} --session-dir /tmp/custom-msa-sessions --session test-session`,
      );
    }),
  );

const quotesSessionDirsContainingSpaces = () =>
  runTest(
    Effect.gen(function* () {
      setStdoutIsTTY(true);
      const sessionFile = yield* createTempFile;
      const sessionManager = createSessionManager({
        sessionDir: "/tmp/custom msa sessions",
        sessionFile,
        sessionId: "test-session",
        usesDefaultSessionDir: false,
      });
      expect(formatResumeCommand(sessionManager)).toBe(
        `${APP_NAME} --session-dir '/tmp/custom msa sessions' --session test-session`,
      );
    }),
  );

const quotesSessionDirsContainingSingleQuotes = () =>
  runTest(
    Effect.gen(function* () {
      setStdoutIsTTY(true);
      const sessionFile = yield* createTempFile;
      const sessionManager = createSessionManager({
        sessionDir: "/tmp/custom msa's sessions",
        sessionFile,
        sessionId: "test-session",
        usesDefaultSessionDir: false,
      });
      expect(formatResumeCommand(sessionManager)).toBe(
        `${APP_NAME} --session-dir '/tmp/custom msa'\\''s sessions' --session test-session`,
      );
    }),
  );

const returnsUndefinedWhenStdoutIsNotA = () =>
  runTest(
    Effect.gen(function* () {
      setStdoutIsTTY(false);
      const sessionFile = yield* createTempFile;
      const sessionManager = createSessionManager({ sessionFile });
      expect(formatResumeCommand(sessionManager)).toBeUndefined();
    }),
  );

const returnsUndefinedForInMemorySessions = () =>
  runTest(
    Effect.gen(function* () {
      setStdoutIsTTY(true);
      const sessionFile = yield* createTempFile;
      const sessionManager = createSessionManager({ persisted: false, sessionFile });
      expect(formatResumeCommand(sessionManager)).toBeUndefined();
    }),
  );

const returnsUndefinedWhenTheSessionFileIs = () => {
  setStdoutIsTTY(true);
  const sessionManager = createSessionManager({ sessionFile: "/tmp/msa-missing-session.jsonl" });

  expect(formatResumeCommand(sessionManager)).toBeUndefined();
};

const returnsUndefinedWhenTheSessionFileIs2 = () => {
  setStdoutIsTTY(true);
  const sessionManager = createSessionManager({});

  expect(formatResumeCommand(sessionManager)).toBeUndefined();
};

describe("formatResumeCommand", () => {
  it(
    "returns a session resume command for default session dirs",
    returnsASessionResumeCommandForDefault,
  );

  it(
    "includes unquoted safe session dirs for non-default session dirs",
    includesUnquotedSafeSessionDirsForNon,
  );

  it("quotes session dirs containing spaces", quotesSessionDirsContainingSpaces);

  it("quotes session dirs containing single quotes", quotesSessionDirsContainingSingleQuotes);

  it("returns undefined when stdout is not a TTY", returnsUndefinedWhenStdoutIsNotA);

  it("returns undefined for in-memory sessions", returnsUndefinedForInMemorySessions);

  it("returns undefined when the session file is missing", returnsUndefinedWhenTheSessionFileIs);

  it("returns undefined when the session file is not set", returnsUndefinedWhenTheSessionFileIs2);
});
