import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const { setKeybindings } = tui;

const { awaited, dateFromMillis, runTest, sleep } = testing;

const flushPromises = sleep("1 millis");

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    cwd: overrides.cwd ?? "",
    id: overrides.id,
    path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
    ...(overrides.name === undefined ? {} : { name: overrides.name }),
    allMessagesText: overrides.allMessagesText ?? "hello",
    created: overrides.created ?? dateFromMillis(0),
    firstMessage: overrides.firstMessage ?? "hello",
    messageCount: overrides.messageCount ?? 1,
    modified: overrides.modified ?? dateFromMillis(0),
  };
}

const CTRL_R = "\x1b[114;5u";

const showsRenameHintInInteractiveResumePicker = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const sessions = [makeSession({ id: "a" })];
      const keybindings = new KeybindingsManager();
      const selector = new SessionSelectorComponent(
        () => effectRunPromise(awaited(sessions)),
        () => effectRunPromise(awaited([])),
        () => {},
        () => {},
        () => {},
        () => {},
        { keybindings, showRenameHint: true },
      );
      yield* flushPromises;

      const output = selector.render(120).join("\n");
      expect(output).toContain("ctrl+r");
      expect(output).toContain("rename");
    }),
  );

const doesNotShowRenameHintInResume = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const sessions = [makeSession({ id: "a" })];
      const keybindings = new KeybindingsManager();
      const selector = new SessionSelectorComponent(
        () => effectRunPromise(awaited(sessions)),
        () => effectRunPromise(awaited([])),
        () => {},
        () => {},
        () => {},
        () => {},
        { keybindings, showRenameHint: false },
      );
      yield* flushPromises;

      const output = selector.render(120).join("\n");
      expect(output).not.toContain("ctrl+r");
      expect(output).not.toContain("rename");
    }),
  );

const entersRenameModeOnCtrlRAnd = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const sessions = [makeSession({ id: "a", name: "Old" })];
      const renameSession = vi.fn(() => effectRunPromise(Effect.sync(() => {})));

      const keybindings = new KeybindingsManager();
      const selector = new SessionSelectorComponent(
        () => effectRunPromise(awaited(sessions)),
        () => effectRunPromise(awaited([])),
        () => {},
        () => {},
        () => {},
        () => {},
        { keybindings, renameSession, showRenameHint: true },
      );
      yield* flushPromises;

      selector.getSessionList().handleInput(CTRL_R);
      yield* flushPromises;

      const output = selector.render(120).join("\n");
      expect(output).toContain("Rename Session");
      expect(output).not.toContain("Resume Session");

      selector.handleInput("X");
      selector.handleInput("\r");
      yield* flushPromises;

      expect(renameSession).toHaveBeenCalledTimes(1);
      expect(renameSession).toHaveBeenCalledWith(sessions[0]!.path, "OldX");
    }),
  );

describe("session selector rename", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  it(
    "shows rename hint in interactive /resume picker configuration",
    showsRenameHintInInteractiveResumePicker,
  );

  it("does not show rename hint in --resume picker configuration", doesNotShowRenameHintInResume);

  it("enters rename mode on Ctrl+R and submits with Enter", entersRenameModeOnCtrlRAnd);
});
