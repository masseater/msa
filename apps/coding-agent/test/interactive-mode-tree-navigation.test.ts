import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import src from "../src/index.ts";
import type statusIndicatorTypes from "../src/modes/interactive/components/status-indicator.types.ts";
import type TreeSelectorComponent from "../src/modes/interactive/components/tree-selector.ts";
import type treeSelectorTypes from "../src/modes/interactive/components/tree-selector.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import utilities from "./utilities.ts";

const { bindModeFake } = interactiveModeFake;

const { SessionManager, SettingsManager } = src;
const { initTheme } = themeModule;

const { Container } = tui;

const { assistantMsg, userMsg } = utilities;

const { awaited, runTest } = testing;

const busyMessage =
  "Wait for the current compaction or tree navigation to finish before navigating the session tree.";

const createTreeSession = () => {
  const session = {
    compaction: { manual: { isCompacting: false } },
    context: {
      tree: {
        abortBranchSummary: vi.fn(),
        navigateTree: vi.fn(() =>
          runTest(
            Effect.gen(function* () {
              if (session.compaction.manual.isCompacting) throw new Error(busyMessage);
              return yield* awaited({ cancelled: false });
            }),
          ),
        ),
      },
    },
    isStreaming: false,
    run: {
      lifecycle: {
        abort: vi.fn(() =>
          runTest(
            Effect.sync(() => {
              session.isStreaming = false;
            }),
          ),
        ),
      },
    },
  };
  return session;
};

type TreeSelectorFactory = (done: () => void) => {
  component: treeSelectorTypes.TreeSelectorComponent;
  focus: treeSelectorTypes.TreeSelectorComponent;
};

function createTreeUI() {
  const sessionManager = SessionManager.inMemory();
  const targetId = sessionManager.appendMessage(userMsg("first"));
  sessionManager.appendMessage(assistantMsg("reply"));
  let selector: treeSelectorTypes.TreeSelectorComponent | undefined;
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
    showStatusIndicator: vi.fn((indicator: statusIndicatorTypes.StatusIndicator) =>
      indicator.dispose(),
    ),
    ui: { requestRender: vi.fn(), terminal: { rows: 24, setProgress: vi.fn() } },
  };
  bindModeFake(ui);
  bindModeFake(ui).selectors.tree.showTreeSelector();

  return {
    onEscape,
    select() {
      return selectTreeEntry(selector, targetId);
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
                ui.session.compaction.manual.isCompacting = true;
                return yield* awaited(choice);
              }),
            ),
          );

          yield* awaited(select());

          expect(ui.showError).toHaveBeenCalledWith(busyMessage);
          expect(ui.showStatusIndicator).not.toHaveBeenCalled();
          expect(ui.clearStatusIndicator).not.toHaveBeenCalled();
          expect(ui.defaultEditor.onEscape).toBe(onEscape);
          expect(ui.session.context.tree.navigateTree).not.toHaveBeenCalled();
          expect(ui.session.run.lifecycle.abort).not.toHaveBeenCalled();
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
        ui.session.compaction.manual.isCompacting = true;
        ui.extensionDialogs.select.mockImplementation(() =>
          effectRunPromise(
            Effect.gen(function* () {
              ui.session.compaction.manual.isCompacting = false;
              return yield* awaited("No summary");
            }),
          ),
        );

        yield* awaited(select());

        expect(ui.session.context.tree.navigateTree).toHaveBeenCalledWith(targetId, {
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
        ui.session.context.tree.navigateTree.mockImplementation(() =>
          effectRunPromise(
            Effect.gen(function* () {
              expect(ui.session.isStreaming).toBe(false);
              expect(ui.restoreQueuedMessagesToEditor).toHaveBeenCalledOnce();
              return yield* awaited({ cancelled: false });
            }),
          ),
        );

        yield* awaited(select());

        expect(ui.session.run.lifecycle.abort).toHaveBeenCalledOnce();
        expect(ui.session.context.tree.navigateTree).toHaveBeenCalledOnce();
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
        ui.session.run.lifecycle.abort.mockImplementation(() =>
          effectRunPromise(
            Effect.sync(() => {
              ui.session.isStreaming = false;
              ui.session.compaction.manual.isCompacting = true;
            }),
          ),
        );

        yield* awaited(select());

        expect(ui.session.run.lifecycle.abort).toHaveBeenCalledOnce();
        expect(ui.showError).toHaveBeenCalledWith(busyMessage);
        expect(ui.showStatusIndicator).not.toHaveBeenCalled();
        expect(ui.clearStatusIndicator).not.toHaveBeenCalled();
        expect(ui.defaultEditor.onEscape).toBe(onEscape);
        expect(ui.session.context.tree.navigateTree).not.toHaveBeenCalled();
      }),
    ));
});

function selectTreeEntry(selector: TreeSelectorComponent | undefined, targetId: string) {
  return runTest(
    Effect.gen(function* () {
      expect(selector).toBeDefined();
      yield* awaited(selector!.getTreeList().onSelect!(targetId));
    }),
  );
}
