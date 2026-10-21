import testing from "@msa/testing";
import { Effect } from "effect";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
const {
  dateFromMillis,
  joinPath,
  makeDirectory,
  makeSymlink,
  makeTempDir,
  removePath,
  runTest,
  sleep,
  writeTextFile,
} = testing;

const flushPromises = sleep("1 millis");

function makeSession(
  overrides: Partial<sessionManagerTypes.SessionInfo> & { id: string },
): sessionManagerTypes.SessionInfo {
  return {
    cwd: overrides.cwd ?? "",
    id: overrides.id,
    path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
    ...(overrides.name === undefined ? {} : { name: overrides.name }),
    ...(overrides.parentSessionPath === undefined
      ? {}
      : { parentSessionPath: overrides.parentSessionPath }),
    allMessagesText: overrides.allMessagesText ?? "hello",
    created: overrides.created ?? dateFromMillis(0),
    firstMessage: overrides.firstMessage ?? "hello",
    messageCount: overrides.messageCount ?? 1,
    modified: overrides.modified ?? dateFromMillis(0),
  };
}

const createSymlinkedSessionPaths: Effect.Effect<{
  baseDir: string;
  parentAliasA: string;
  parentAliasB: string;
  childAliasB: string;
}> = Effect.gen(function* () {
  const baseDir = yield* makeTempDir("msa-session-selector-");
  const realDir = joinPath(baseDir, "real");
  const aliasADir = joinPath(baseDir, "alias-a");
  const aliasBDir = joinPath(baseDir, "alias-b");
  yield* makeDirectory(realDir);
  yield* makeDirectory(aliasADir);
  yield* makeDirectory(aliasBDir);

  const sharedDir = joinPath(realDir, "sessions");
  yield* makeDirectory(sharedDir);
  const aliasASessions = joinPath(aliasADir, "sessions");
  const aliasBSessions = joinPath(aliasBDir, "sessions");
  yield* makeSymlink(sharedDir, aliasASessions);
  yield* makeSymlink(sharedDir, aliasBSessions);

  const parentRealPath = joinPath(sharedDir, "parent.jsonl");
  const childRealPath = joinPath(sharedDir, "child.jsonl");
  yield* writeTextFile(parentRealPath, "parent\n");
  yield* writeTextFile(childRealPath, "child\n");

  return {
    baseDir,
    childAliasB: joinPath(aliasBSessions, "child.jsonl"),
    parentAliasA: joinPath(aliasASessions, "parent.jsonl"),
    parentAliasB: joinPath(aliasBSessions, "parent.jsonl"),
  };
});

const CTRL_D = "\x04";

const keybindings = new KeybindingsManager();

const tempDirs: string[] = [];

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      for (const dir of tempDirs.splice(0)) {
        yield* removePath(dir);
      }
    }),
  );

const sessionSelectorPathDeleteSupport = {
  CTRL_D,
  afterEachHook,
  createSymlinkedSessionPaths,
  flushPromises,
  keybindings,
  makeSession,
  tempDirs,
};

export default sessionSelectorPathDeleteSupport;
