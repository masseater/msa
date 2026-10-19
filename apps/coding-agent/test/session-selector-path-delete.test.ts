import {
  awaited,
  runTest,
  deferredPromise,
  joinPath,
  dateFromMillis,
  makeDirectory,
  makeTempDir,
  removePath,
  sleep,
  testRuntime,
  writeTextFile,
} from "@msa/testing";
import { setKeybindings } from "@msa/tui";
import { Effect, FileSystem } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const flushPromises = sleep("1 millis");

const fileSystem = testRuntime.runSync(FileSystem.FileSystem);

const symlink = (from: string, to: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.symlink(from, to));

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
    id: overrides.id,
    cwd: overrides.cwd ?? "",
    ...(overrides.name === undefined ? {} : { name: overrides.name }),
    ...(overrides.parentSessionPath === undefined
      ? {}
      : { parentSessionPath: overrides.parentSessionPath }),
    created: overrides.created ?? dateFromMillis(0),
    modified: overrides.modified ?? dateFromMillis(0),
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "hello",
    allMessagesText: overrides.allMessagesText ?? "hello",
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
  yield* symlink(sharedDir, aliasASessions);
  yield* symlink(sharedDir, aliasBSessions);

  const parentRealPath = joinPath(sharedDir, "parent.jsonl");
  const childRealPath = joinPath(sharedDir, "child.jsonl");
  yield* writeTextFile(parentRealPath, "parent\n");
  yield* writeTextFile(childRealPath, "child\n");

  return {
    baseDir,
    parentAliasA: joinPath(aliasASessions, "parent.jsonl"),
    parentAliasB: joinPath(aliasBSessions, "parent.jsonl"),
    childAliasB: joinPath(aliasBSessions, "child.jsonl"),
  };
});

const CTRL_D = "\x04";
const CTRL_BACKSPACE = "\x1b[127;5u";

describe("session selector path/delete interactions", () => {
  const keybindings = new KeybindingsManager();
  const tempDirs: string[] = [];

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        for (const dir of tempDirs.splice(0)) {
          yield* removePath(dir);
        }
      }),
    ),
  );

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  beforeAll(() => {
    initTheme("dark");
  });
  it("does not treat Ctrl+Backspace as delete when search query is non-empty", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(sessions)),
          () => effectRunPromise(awaited([])),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const list = selector.getSessionList();
        const confirmationChanges: Array<string | null> = [];
        list.onDeleteConfirmationChange = (path) => confirmationChanges.push(path);

        list.handleInput("a");
        list.handleInput(CTRL_BACKSPACE);

        expect(confirmationChanges).toEqual([]);
      }),
    ));

  it("enters confirmation mode on Ctrl+D even with a non-empty search query", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(sessions)),
          () => effectRunPromise(awaited([])),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const list = selector.getSessionList();
        const confirmationChanges: Array<string | null> = [];
        list.onDeleteConfirmationChange = (path) => confirmationChanges.push(path);

        list.handleInput("a");
        list.handleInput(CTRL_D);

        expect(confirmationChanges).toEqual([sessions[0]!.path]);
      }),
    ));

  it("enters confirmation mode on Ctrl+Backspace when search query is empty", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(sessions)),
          () => effectRunPromise(awaited([])),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const list = selector.getSessionList();
        const confirmationChanges: Array<string | null> = [];
        list.onDeleteConfirmationChange = (path) => confirmationChanges.push(path);

        let deletedPath: string | null = null;
        list.onDeleteSession = (sessionPath) =>
          effectRunPromise(
            Effect.sync(() => {
              deletedPath = sessionPath;
            }),
          );

        list.handleInput(CTRL_BACKSPACE);
        expect(confirmationChanges).toEqual([sessions[0]!.path]);

        list.handleInput("\r");
        expect(confirmationChanges).toEqual([sessions[0]!.path, null]);
        expect(deletedPath).toBe(sessions[0]!.path);
      }),
    ));

  it("does not switch scope back to All when All load resolves after toggling back to Current", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const currentSessions = [makeSession({ id: "current" })];
        const allDeferred = deferredPromise<SessionInfo[]>();
        let allLoadCalls = 0;

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(currentSessions)),
          () =>
            effectRunPromise(
              Effect.gen(function* () {
                allLoadCalls++;
                return yield* awaited(allDeferred.promise);
              }),
            ),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const list = selector.getSessionList();
        list.handleInput("\t");
        list.handleInput("\t");

        allDeferred.resolve([makeSession({ id: "all" })]);
        yield* flushPromises;

        expect(allLoadCalls).toBe(1);
        const output = selector.render(120).join("\n");
        expect(output).toContain("Resume Session (Current Folder)");
        expect(output).not.toContain("Resume Session (All)");
      }),
    ));

  it("does not start redundant All loads when toggling scopes while All is already loading", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const currentSessions = [makeSession({ id: "current" })];
        const allSessions = [makeSession({ id: "all" })];
        const allDeferred = deferredPromise<SessionInfo[]>();
        let allLoadCalls = 0;

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(currentSessions)),
          (onProgress) =>
            effectRunPromise(
              Effect.gen(function* () {
                allLoadCalls++;
                onProgress?.(1, 2, allSessions);
                return yield* awaited(allDeferred.promise);
              }),
            ),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const list = selector.getSessionList();
        list.handleInput("\t");
        list.handleInput("\t");
        list.handleInput("\t");

        expect(allLoadCalls).toBe(1);
        expect(selector.getSessionList().getSelectedSessionPath()).toBe(allSessions[0]!.path);
        expect(selector.render(120).join("\n")).toContain("Loading");

        allDeferred.resolve(allSessions);
        yield* flushPromises;
      }),
    ));

  it("threads sessions when parent and child paths use different symlink aliases", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const paths = yield* createSymlinkedSessionPaths;
        tempDirs.push(paths.baseDir);

        const sessions = [
          makeSession({
            id: "parent",
            path: paths.parentAliasB,
            name: "Parent",
            modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
          }),
          makeSession({
            id: "child",
            path: paths.childAliasB,
            parentSessionPath: paths.parentAliasA,
            name: "Child",
            modified: dateFromMillis("2025-12-31T00:00:00.000Z"),
          }),
        ];

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(sessions)),
          () => effectRunPromise(awaited([])),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const output = stripAnsi(selector.render(120).join("\n"));
        expect(output).toContain("Parent");
        expect(output).toContain("└─ Child");
      }),
    ));

  it("sorts threaded sessions by latest activity in their subtree", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const parentOne = makeSession({
          id: "parent-one",
          name: "Parent one",
          modified: dateFromMillis("2026-01-02T00:00:00.000Z"),
        });
        const parentTwo = makeSession({
          id: "parent-two",
          name: "Parent two",
          modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
        });
        const childTwo = makeSession({
          id: "child-two",
          name: "Child two",
          parentSessionPath: parentTwo.path,
          modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
        });

        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited([parentOne, parentTwo, childTwo])),
          () => effectRunPromise(awaited([])),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
        );
        yield* flushPromises;

        const output = stripAnsi(selector.render(120).join("\n"));
        const parentTwoIndex = output.indexOf("Parent two");
        const childTwoIndex = output.indexOf("└─ Child two");
        const parentOneIndex = output.indexOf("Parent one");

        expect(parentTwoIndex).toBeGreaterThanOrEqual(0);
        expect(childTwoIndex).toBeGreaterThan(parentTwoIndex);
        expect(parentOneIndex).toBeGreaterThan(childTwoIndex);
      }),
    ));

  it("treats the current session as active across symlink aliases", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const paths = yield* createSymlinkedSessionPaths;
        tempDirs.push(paths.baseDir);

        const sessions = [makeSession({ id: "parent", path: paths.parentAliasB, name: "Parent" })];
        const selector = new SessionSelectorComponent(
          () => effectRunPromise(awaited(sessions)),
          () => effectRunPromise(awaited([])),
          () => {},
          () => {},
          () => {},
          () => {},
          { keybindings },
          paths.parentAliasA,
        );
        yield* flushPromises;

        const list = selector.getSessionList();
        const confirmationChanges: Array<string | null> = [];
        let errorMessage: string | undefined;
        list.onDeleteConfirmationChange = (path) => confirmationChanges.push(path);
        list.onError = (message) => {
          errorMessage = message;
        };

        list.handleInput(CTRL_D);

        expect(confirmationChanges).toEqual([]);
        expect(errorMessage).toBe("Cannot delete the currently active session");
      }),
    ));
});
