import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import SessionSelectorComponent from "../src/modes/interactive/components/session-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import sessionSelectorPathDeleteSupport from "./session-selector-path-delete-support.ts";
const { initTheme } = themeModule;

const { setKeybindings } = tui;

const {
  CTRL_D,
  afterEachHook,
  createSymlinkedSessionPaths,
  flushPromises,
  keybindings,
  makeSession,
  tempDirs,
} = sessionSelectorPathDeleteSupport;

const { awaited, runTest } = testing;

const treatsTheCurrentSessionAsActiveAcross = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const paths = yield* createSymlinkedSessionPaths;
      tempDirs.push(paths.baseDir);

      const sessions = [makeSession({ id: "parent", name: "Parent", path: paths.parentAliasB })];
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
      yield* awaited(selector.getSessionList().pathsResolved);

      const list = selector.getSessionList();
      const confirmationChanges: Array<string | null> = [];
      let errorMessage: string | undefined;
      list.onDeleteConfirmationChange = (path) => confirmationChanges.push(path);
      list.onError = (message) => {
        errorMessage = message;
      };

      list.input.handleInput(CTRL_D);

      expect(confirmationChanges).toEqual([]);
      expect(errorMessage).toBe("Cannot delete the currently active session");
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
    "treats the current session as active across symlink aliases",
    treatsTheCurrentSessionAsActiveAcross,
  );
});
