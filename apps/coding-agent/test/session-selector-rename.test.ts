import { awaited, runTest, dateFromMillis } from "@msa/testing";
import { setKeybindings } from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function flushPromises(): Promise<void> {
  return runTest(
    Effect.gen(function* () {
      yield* awaited(
        new Promise<void>((resolve) => {
          setImmediate(resolve);
        }),
      );
    }),
  );
}

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
    id: overrides.id,
    cwd: overrides.cwd ?? "",
    ...(overrides.name === undefined ? {} : { name: overrides.name }),
    created: overrides.created ?? dateFromMillis(0),
    modified: overrides.modified ?? dateFromMillis(0),
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "hello",
    allMessagesText: overrides.allMessagesText ?? "hello",
  };
}

const CTRL_R = "\x1b[114;5u";

describe("session selector rename", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  it("shows rename hint in interactive /resume picker configuration", () =>
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
          { showRenameHint: true, keybindings },
        );
        yield* awaited(flushPromises());

        const output = selector.render(120).join("\n");
        expect(output).toContain("ctrl+r");
        expect(output).toContain("rename");
      }),
    ));

  it("does not show rename hint in --resume picker configuration", () =>
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
          { showRenameHint: false, keybindings },
        );
        yield* awaited(flushPromises());

        const output = selector.render(120).join("\n");
        expect(output).not.toContain("ctrl+r");
        expect(output).not.toContain("rename");
      }),
    ));

  it("enters rename mode on Ctrl+R and submits with Enter", () =>
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
          { renameSession, showRenameHint: true, keybindings },
        );
        yield* awaited(flushPromises());

        selector.getSessionList().handleInput(CTRL_R);
        yield* awaited(flushPromises());

        const output = selector.render(120).join("\n");
        expect(output).toContain("Rename Session");
        expect(output).not.toContain("Resume Session");

        selector.handleInput("X");
        selector.handleInput("\r");
        yield* awaited(flushPromises());

        expect(renameSession).toHaveBeenCalledTimes(1);
        expect(renameSession).toHaveBeenCalledWith(sessions[0]!.path, "XOld");
      }),
    ));
});
