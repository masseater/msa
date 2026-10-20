import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import themeModule from "../../../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "../../interactive-mode-fake.ts";
import SessionStartNotifySupport from "./5943-session-start-notify-support.ts";

const { bindModeFake } = interactiveModeFake;

const { initTheme } = themeModule;

const { createReloadCommandContext } = SessionStartNotifySupport;

const { gate } = testing;

const keepsTheReloadBlockerFocusedUntil = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  initTheme("dark", false);
  const editor = {};
  let focused: unknown;
  let chatRestored = false;
  const reloadWaiting = gate();
  const reloadFinished = gate();

  const context = createReloadCommandContext({
    editor,
    rebuildChatFromMessages: () => {
      chatRestored = true;
    },
    session: {
      extensions: {
        runtime: {
          reload: (options) =>
            runPromise(
              Effect.gen(function* () {
                yield* Effect.promise(() => Promise.resolve(options?.beforeSessionStart?.()));
                reloadWaiting.release();
                yield* Effect.promise(() => reloadFinished);
              }),
            ),
        },
      },
    },
    ui: {
      setFocus: (component) => {
        focused = component;
      },
    },
  });

  bindModeFake(context);
  const reloadPromise = bindModeFake(context).commands.reload.handleReloadCommand();
  yield* Effect.promise(() => reloadWaiting);

  expect(chatRestored).toBe(true);
  expect(focused).not.toBe(editor);

  reloadFinished.release();
  yield* Effect.promise(() => reloadPromise);

  expect(focused).toBe(editor);
});

const keepsTheReloadBlockerFocusedUntilAsync = () =>
  Effect.runPromise(keepsTheReloadBlockerFocusedUntil);

describe("regression #5943: session_start transient UI", () => {
  it(
    "keeps the reload blocker focused until async reload completes",
    keepsTheReloadBlockerFocusedUntilAsync,
  );
});
