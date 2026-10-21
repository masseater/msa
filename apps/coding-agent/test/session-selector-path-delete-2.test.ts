import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import SessionSelectorComponent from "../src/modes/interactive/components/session-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import sessionSelectorPathDeleteSupport from "./session-selector-path-delete-support.ts";
const { initTheme } = themeModule;

const { setKeybindings } = tui;

const { afterEachHook, flushPromises, keybindings, makeSession } = sessionSelectorPathDeleteSupport;

const { awaited, deferredPromise, runTest } = testing;

const doesNotSwitchScopeBackToAll = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const currentSessions = [makeSession({ id: "current" })];
      const allDeferred = deferredPromise<sessionManagerTypes.SessionInfo[]>();
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
      list.input.handleInput("\t");
      list.input.handleInput("\t");

      allDeferred.resolve([makeSession({ id: "all" })]);
      yield* flushPromises;

      expect(allLoadCalls).toBe(1);
      const output = selector.render(120).join("\n");
      expect(output).toContain("Resume Session (Current Folder)");
      expect(output).not.toContain("Resume Session (All)");
    }),
  );

const doesNotStartRedundantAllLoadsWhen = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const currentSessions = [makeSession({ id: "current" })];
      const allSessions = [makeSession({ id: "all" })];
      const allDeferred = deferredPromise<sessionManagerTypes.SessionInfo[]>();
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
      list.input.handleInput("\t");
      list.input.handleInput("\t");
      list.input.handleInput("\t");

      expect(allLoadCalls).toBe(1);
      expect(selector.getSessionList().getSelectedSessionPath()).toBe(allSessions[0]!.path);
      expect(selector.render(120).join("\n")).toContain("Loading");

      allDeferred.resolve(allSessions);
      yield* flushPromises;
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
    "does not switch scope back to All when All load resolves after toggling back to Current",
    doesNotSwitchScopeBackToAll,
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
    "does not start redundant All loads when toggling scopes while All is already loading",
    doesNotStartRedundantAllLoadsWhen,
  );
});
