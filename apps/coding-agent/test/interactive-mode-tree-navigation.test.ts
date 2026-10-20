import testing from "@msa/testing";
import { Container } from "@msa/tui";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { InteractiveMode, SessionManager, SettingsManager } from "../src/index.ts";
import type { StatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import type { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import utilities from "./utilities.ts";

const { assistantMsg, userMsg } = utilities;

const { awaited, runTest } = testing;

const busyMessage =
  "Wait for the current compaction or tree navigation to finish before navigating the session tree.";

const createTreeSession = () => {
  const session = {
    abort: vi.fn(() =>
      runTest(
        Effect.sync(() => {
          session.isStreaming = false;
        }),
      ),
    ),
    abortBranchSummary: vi.fn(),
    isCompacting: false,
    isStreaming: false,
    navigateTree: vi.fn(() =>
      runTest(
        Effect.gen(function* () {
          if (session.isCompacting) throw new Error(busyMessage);
          return yield* awaited({ cancelled: false });
        }),
      ),
    ),
  };
  return session;
};

type TreeSelectorFactory = (done: () => void) => {
  component: TreeSelectorComponent;
  focus: TreeSelectorComponent;
};

function createTreeUI() {
  const sessionManager = SessionManager.inMemory();
  const targetId = sessionManager.appendMessage(userMsg("first"));
  sessionManager.appendMessage(assistantMsg("reply"));
  let selector: TreeSelectorComponent | undefined;
  const onEscape = vi.fn();
  const ui = {
    chatContainer: new Container(),
    clearStatusIndicator: vi.fn(),
    defaultEditor: { onEscape },
    editor: { getText: () => "", setText: vi.fn() },
    editorSlot: {
      showSelector: (create: TreeSelectorFactory) => {
        selector = create(vi.fn()).component;
      },
    },
    extensionDialogs: { select: vi.fn(() => runTest(awaited("No summary"))) },
    flushCompactionQueue: vi.fn(() => runTest(Effect.sync(() => {}))),
    footer: { invalidate: vi.fn() },
    isInitialized: true,
    renderInitialMessages: vi.fn(),
    restoreQueuedMessagesToEditor: vi.fn(),
    session: createTreeSession(),
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showStatusIndicator: vi.fn((indicator: StatusIndicator) => indicator.dispose()),
    ui: { requestRender: vi.fn(), terminal: { rows: 24, setProgress: vi.fn() } },
  };
  const showTreeSelector = Reflect.get(InteractiveMode.prototype, "showTreeSelector") as (
    this: typeof ui,
  ) => void;
  showTreeSelector.call(ui);

  return {
    onEscape,
    select() {
      return runTest(
        Effect.gen(function* () {
          expect(selector).toBeDefined();
          yield* awaited(selector!.getTreeList().onSelect!(targetId));
        }),
      );
    },
    targetId,
    ui,
  };
}

describe("InteractiveMode tree navigation availability", () => {
  beforeEach(() => initTheme("dark"));

  it.each(["Summarize", "No summary"])(
    "preserves operation UI when choosing %s while busy",
    (choice) =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const { ui, onEscape, select } = createTreeUI();
          const originalLeafId = ui.sessionManager.getLeafId();
          ui.extensionDialogs.select.mockImplementation(() =>
            effectRunPromise(
              Effect.gen(function* () {
                ui.session.isCompacting = true;
                return yield* awaited(choice);
              }),
            ),
          );

          yield* awaited(select());

          expect(ui.showError).toHaveBeenCalledWith(busyMessage);
          expect(ui.showStatusIndicator).not.toHaveBeenCalled();
          expect(ui.clearStatusIndicator).not.toHaveBeenCalled();
          expect(ui.defaultEditor.onEscape).toBe(onEscape);
          expect(ui.session.navigateTree).not.toHaveBeenCalled();
          expect(ui.session.abort).not.toHaveBeenCalled();
          expect(ui.sessionManager.getLeafId()).toBe(originalLeafId);
        }),
      ),
  );
});

describe("InteractiveMode tree navigation availability", () => {
  beforeEach(() => initTheme("dark"));

  it("allows navigation when compaction finishes while the dialog is open", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { ui, targetId, select } = createTreeUI();
        ui.session.isCompacting = true;
        ui.extensionDialogs.select.mockImplementation(() =>
          effectRunPromise(
            Effect.gen(function* () {
              ui.session.isCompacting = false;
              return yield* awaited("No summary");
            }),
          ),
        );

        yield* awaited(select());

        expect(ui.session.navigateTree).toHaveBeenCalledWith(targetId, {
          customInstructions: undefined,
          summarize: false,
        });
        expect(ui.showError).not.toHaveBeenCalled();
      }),
    ));
});

describe("InteractiveMode tree navigation availability", () => {
  beforeEach(() => initTheme("dark"));

  it("still aborts an active response before navigating", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { ui, select } = createTreeUI();
        ui.session.isStreaming = true;
        ui.session.navigateTree.mockImplementation(() =>
          effectRunPromise(
            Effect.gen(function* () {
              expect(ui.session.isStreaming).toBe(false);
              expect(ui.restoreQueuedMessagesToEditor).toHaveBeenCalledOnce();
              return yield* awaited({ cancelled: false });
            }),
          ),
        );

        yield* awaited(select());

        expect(ui.session.abort).toHaveBeenCalledOnce();
        expect(ui.session.navigateTree).toHaveBeenCalledOnce();
        expect(ui.showError).not.toHaveBeenCalled();
      }),
    ));
});

describe("InteractiveMode tree navigation availability", () => {
  beforeEach(() => initTheme("dark"));

  it("rechecks availability after the response abort settles", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { ui, onEscape, select } = createTreeUI();
        ui.session.isStreaming = true;
        ui.extensionDialogs.select.mockResolvedValue("Summarize");
        ui.session.abort.mockImplementation(() =>
          effectRunPromise(
            Effect.sync(() => {
              ui.session.isStreaming = false;
              ui.session.isCompacting = true;
            }),
          ),
        );

        yield* awaited(select());

        expect(ui.session.abort).toHaveBeenCalledOnce();
        expect(ui.showError).toHaveBeenCalledWith(busyMessage);
        expect(ui.showStatusIndicator).not.toHaveBeenCalled();
        expect(ui.clearStatusIndicator).not.toHaveBeenCalled();
        expect(ui.defaultEditor.onEscape).toBe(onEscape);
        expect(ui.session.navigateTree).not.toHaveBeenCalled();
      }),
    ));
});
