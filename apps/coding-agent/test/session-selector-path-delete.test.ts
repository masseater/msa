import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import sessionSelectorPathDeleteSupport from "./session-selector-path-delete-support.ts";

const { setKeybindings } = tui;

const { CTRL_D, afterEachHook, flushPromises, keybindings, makeSession } =
  sessionSelectorPathDeleteSupport;

const { awaited, runTest } = testing;

const CTRL_BACKSPACE = "\x1b[127;5u";

const doesNotTreatCtrlBackspaceAsDelete = () =>
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
  );

const entersConfirmationModeOnCtrlDEven = () =>
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
  );

const entersConfirmationModeOnCtrlBackspaceWhen = () =>
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
    "does not treat Ctrl+Backspace as delete when search query is non-empty",
    doesNotTreatCtrlBackspaceAsDelete,
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
    "enters confirmation mode on Ctrl+D even with a non-empty search query",
    entersConfirmationModeOnCtrlDEven,
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
    "enters confirmation mode on Ctrl+Backspace when search query is empty",
    entersConfirmationModeOnCtrlBackspaceWhen,
  );
});
