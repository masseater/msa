import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import cliProcess from "./cli-process.ts";

const {
  awaited,
  currentDate,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  makeDirectory,
  makeTempDir,
  readTextFile,
  removeDirs,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const { runCli } = cliProcess;

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const createSessionFile = Effect.fn("createSessionFile")(function* (
  projectDir: string,
  sessionFile: string,
) {
  const timestamp = currentDate().toISOString();
  const header = yield* toJsonText({
    cwd: projectDir,
    id: "existing-session",
    timestamp,
    type: "session",
    version: 3,
  });
  const message = yield* toJsonText({
    id: "assistant-1",
    message: {
      content: [{ text: "hello", type: "text" }],
      model: "claude-sonnet-4-5",
      provider: "anthropic-api",
      role: "assistant",
      timestamp: currentTimeMillis(),
    },
    parentId: null,
    timestamp,
    type: "message",
  });
  yield* writeTextFile(sessionFile, `${header}\n${message}\n`);
});

const readSessionInfoNames = Effect.fn("readSessionInfoNames")(function* (sessionFile: string) {
  const lines = (yield* readTextFile(sessionFile)).trim().split("\n");
  const entries = yield* Effect.forEach(lines, fromJsonText);
  return (entries as { type?: string; name?: string }[])
    .filter((entry) => entry.type === "session_info")
    .map((entry) => entry.name ?? "");
});

const setup = Effect.fn("setup")(function* () {
  const tempRoot = yield* makeTempDir("msa-startup-session-name-");
  tempDirs.push(tempRoot);
  const dirs = {
    agentDir: joinPath(tempRoot, "agent"),
    projectDir: joinPath(tempRoot, "project"),
    sessionFile: joinPath(tempRoot, "session.jsonl"),
  };
  yield* makeDirectory(dirs.agentDir);
  yield* makeDirectory(dirs.projectDir);
  yield* createSessionFile(dirs.projectDir, dirs.sessionFile);
  return dirs;
});

const setsTheNameBeforeModelValidation = Effect.gen(function* () {
  const dirs = yield* setup();
  const result = yield* awaited(
    runCli(
      [
        "--session",
        dirs.sessionFile,
        "--name",
        "  CLI Named Session  ",
        "--model",
        "missing-model",
        "-p",
        "hi",
      ],
      { agentDir: dirs.agentDir, cwd: dirs.projectDir },
    ),
  );
  expect(result.code).toBe(1);
  expect(yield* readSessionInfoNames(dirs.sessionFile)).toEqual(["CLI Named Session"]);
});

describe("startup session name", () => {
  it("sets --name on the selected session before runtime model validation", () =>
    runTest(setsTheNameBeforeModelValidation));
});
