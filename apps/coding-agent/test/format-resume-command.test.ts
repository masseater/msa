import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { joinPath, runTest, removePath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { APP_NAME } from "../src/config.ts";
import type { SessionManager } from "../src/core/session-manager.ts";
import { formatResumeCommand } from "../src/modes/interactive/interactive-mode.ts";

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

function createTempFile(): string {
  const dir = mkdtempSync(joinPath(tmpdir(), "msa-format-resume-command-"));
  tempDirs.push(dir);
  const file = joinPath(dir, "session.jsonl");
  writeFileSync(file, "\n");
  return file;
}

function createSessionManager(options: {
  persisted?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionDir?: string;
  usesDefaultSessionDir?: boolean;
}): SessionManager {
  return {
    isPersisted: () => options.persisted ?? true,
    getSessionFile: () => options.sessionFile,
    getSessionId: () => options.sessionId ?? "0197f6e4-4cf9-7f44-a2d8-f8f7f49ee9d3",
    getSessionDir: () => options.sessionDir ?? "/tmp/msa-sessions",
    usesDefaultSessionDir: () => options.usesDefaultSessionDir ?? true,
  } as unknown as SessionManager;
}

describe("formatResumeCommand", () => {
  it("returns a session resume command for default session dirs", () => {
    setStdoutIsTTY(true);
    const sessionFile = createTempFile();
    const sessionManager = createSessionManager({ sessionFile, sessionId: "test-session" });

    expect(formatResumeCommand(sessionManager)).toBe(`${APP_NAME} --session test-session`);
  });

  it("includes unquoted safe session dirs for non-default session dirs", () => {
    setStdoutIsTTY(true);
    const sessionFile = createTempFile();
    const sessionManager = createSessionManager({
      sessionFile,
      sessionId: "test-session",
      sessionDir: "/tmp/custom-msa-sessions",
      usesDefaultSessionDir: false,
    });

    expect(formatResumeCommand(sessionManager)).toBe(
      `${APP_NAME} --session-dir /tmp/custom-msa-sessions --session test-session`,
    );
  });

  it("quotes session dirs containing spaces", () => {
    setStdoutIsTTY(true);
    const sessionFile = createTempFile();
    const sessionManager = createSessionManager({
      sessionFile,
      sessionId: "test-session",
      sessionDir: "/tmp/custom msa sessions",
      usesDefaultSessionDir: false,
    });

    expect(formatResumeCommand(sessionManager)).toBe(
      `${APP_NAME} --session-dir '/tmp/custom msa sessions' --session test-session`,
    );
  });

  it("quotes session dirs containing single quotes", () => {
    setStdoutIsTTY(true);
    const sessionFile = createTempFile();
    const sessionManager = createSessionManager({
      sessionFile,
      sessionId: "test-session",
      sessionDir: "/tmp/custom msa's sessions",
      usesDefaultSessionDir: false,
    });

    expect(formatResumeCommand(sessionManager)).toBe(
      `${APP_NAME} --session-dir '/tmp/custom msa'\\''s sessions' --session test-session`,
    );
  });

  it("returns undefined when stdout is not a TTY", () => {
    setStdoutIsTTY(false);
    const sessionFile = createTempFile();
    const sessionManager = createSessionManager({ sessionFile });

    expect(formatResumeCommand(sessionManager)).toBeUndefined();
  });

  it("returns undefined for in-memory sessions", () => {
    setStdoutIsTTY(true);
    const sessionFile = createTempFile();
    const sessionManager = createSessionManager({ persisted: false, sessionFile });

    expect(formatResumeCommand(sessionManager)).toBeUndefined();
  });

  it("returns undefined when the session file is missing", () => {
    setStdoutIsTTY(true);
    const sessionManager = createSessionManager({ sessionFile: "/tmp/msa-missing-session.jsonl" });

    expect(formatResumeCommand(sessionManager)).toBeUndefined();
  });

  it("returns undefined when the session file is not set", () => {
    setStdoutIsTTY(true);
    const sessionManager = createSessionManager({});

    expect(formatResumeCommand(sessionManager)).toBeUndefined();
  });
});
