import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import SessionSelectorComponent from "../src/modes/interactive/components/session-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import sessionSelectorPathDeleteSupport from "./session-selector-path-delete-support.ts";
const { stripAnsi } = ansi;
const { initTheme } = themeModule;

const { setKeybindings } = tui;

const {
  afterEachHook,
  createSymlinkedSessionPaths,
  flushPromises,
  keybindings,
  makeSession,
  tempDirs,
} = sessionSelectorPathDeleteSupport;

const { awaited, dateFromMillis, runTest } = testing;

const threadsSessionsWhenParentAndChildPaths = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const paths = yield* createSymlinkedSessionPaths;
      tempDirs.push(paths.baseDir);

      const sessions = [
        makeSession({
          id: "parent",
          modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
          name: "Parent",
          path: paths.parentAliasB,
        }),
        makeSession({
          id: "child",
          modified: dateFromMillis("2025-12-31T00:00:00.000Z"),
          name: "Child",
          parentSessionPath: paths.parentAliasA,
          path: paths.childAliasB,
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
  );

const sortsThreadedSessionsByLatestActivityIn = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const parentOne = makeSession({
        id: "parent-one",
        modified: dateFromMillis("2026-01-02T00:00:00.000Z"),
        name: "Parent one",
      });
      const parentTwo = makeSession({
        id: "parent-two",
        modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
        name: "Parent two",
      });
      const childTwo = makeSession({
        id: "child-two",
        modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
        name: "Child two",
        parentSessionPath: parentTwo.path,
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
  );

describe("session selector path/delete interactions", () => {
  afterEach(afterEachHook);

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  beforeAll(() => {
    initTheme("dark");
  });

  it(
    "threads sessions when parent and child paths use different symlink aliases",
    threadsSessionsWhenParentAndChildPaths,
  );
});

describe("session selector path/delete interactions", () => {
  afterEach(afterEachHook);

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  beforeAll(() => {
    initTheme("dark");
  });

  it(
    "sorts threaded sessions by latest activity in their subtree",
    sortsThreadedSessionsByLatestActivityIn,
  );
});
