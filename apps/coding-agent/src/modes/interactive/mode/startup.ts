import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import platform from "../../../core/platform/index.ts";
import syntaxHighlight from "../../../utils/syntax-highlight.ts";
import toolsManager from "../../../utils/tools-manager.ts";
import chatViewport from "../chat-viewport.ts";
import keybindingHints from "../components/keybinding-hints.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme, onThemeChange } = themeModule;
const { Text } = tuiModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { writeLog } = platform;
const { formatKeyText } = keybindingHints;
const { createChatViewport } = chatViewport;
const { ensureTool } = toolsManager;
const { loadAllHighlightLanguages } = syntaxHighlight;

export default class ModeStartup {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  isInitialized = false;

  private startTui(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mode.lifecycle.screen.mountInteractiveTui(this.mode.lifecycle.screen.renderer, [
        this.mode.layout.documentContainer,
        this.mode.layout.pendingMessagesContainer,
        this.mode.layout.statusContainer,
        this.mode.layout.extensionWidgets.above,
        this.mode.layout.editorContainer,
        this.mode.layout.extensionWidgets.below,
        this.mode.layout.footerContainer,
      ]);
      this.mode.defaultEditor.onAction("app.clear", () => this.mode.input.keys.handleCtrlC());
      this.mode.defaultEditor.onCtrlD = () => this.mode.input.keys.handleCtrlD();
      this.mode.defaultEditor.onSubmit = (text) => this.mode.input.submit.handleStartupSubmit(text);
      this.mode.ui.setFocus(this.mode.editor);

      this.mode.ui.start();
      this.isInitialized = true;
      this.mode.layout.programStatus.report();
      this.mode.lifecycle.screen.ensurePngTranscoder();

      this.mode.display.theme.themeController.applyFromSettings();
      yield* awaited(this.mode.display.theme.themeController.waitForTerminalColors());
    }, this);
  }

  private prepareStartupLayout(): {
    header: boolean;
    details: boolean;
  } {
    this.mode.lifecycle.shutdown.registerSignalHandlers();

    const startupVisibility = this.mode.display.resources.getStartupVisibility();
    if (this.mode.session.models.selection.scopedModels.length > 0 && startupVisibility.details) {
      const modelList = this.mode.session.models.selection.scopedModels
        .map((sm) => {
          const thinkingStr = sm.thinkingLevel === undefined ? "" : `:${sm.thinkingLevel}`;
          return `${sm.model.id}${thinkingStr}`;
        })
        .join(", ");
      const cycleKeys = this.mode.keybindings.getKeys("app.model.cycleForward");
      const cycleHint =
        cycleKeys.length > 0
          ? theme.fg(
              "muted",
              ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`,
            )
          : "";
      writeLog(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
    }

    const viewport = createChatViewport({
      document: this.mode.layout.documentContainer,
      editor: this.mode.layout.editorContainer,
      footer: this.mode.layout.footerContainer,
      pendingMessages: this.mode.layout.pendingMessagesContainer,
      scrollbar: this.mode.settingsManager.terminal.getFullscreenScrollbar(),
      scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
      scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
      status: this.mode.layout.statusContainer,
      widgetsAbove: this.mode.layout.extensionWidgets.above,
      widgetsBelow: this.mode.layout.extensionWidgets.below,
    });
    this.mode.layout.transcriptScrollView = viewport.transcript;
    this.mode.layout.fullscreenLayoutRoot = this.mode.selectors.views.orchestratorPane.layout(
      viewport.root,
    );
    return startupVisibility;
  }

  init(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isInitialized) return;

        const changelogMarkdown = yield* awaited(
          this.mode.display.notices.startup.getChangelogForDisplay(),
        );
        const startupVisibility = this.prepareStartupLayout();
        this.mode.display.notices.startup.changelogMarkdown = changelogMarkdown;
        yield* performed(this.startTui());

        if (startupVisibility.header) {
          const { showDetails, withWordmark, compactInstructions, expandedInstructions } =
            this.mode.lifecycle.startupHeader.startupHeaderText(startupVisibility);
          this.mode.lifecycle.startupHeader.mountStartupHeader(
            showDetails,
            withWordmark,
            compactInstructions,
            expandedInstructions,
          );
        } else {
          this.mode.layout.builtInHeader = new Text("", 0, 0);
          this.mode.layout.headerContainer.addChild(this.mode.layout.builtInHeader);
        }
        yield* performed(this.finishStartup());
      }, this),
    );
  }

  private finishStartup(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mode.ui.requestRender();

      const [fdPath] = yield* awaited(
        Promise.all([
          ensureTool("fd", (status) => this.mode.display.status.showManagedToolStatus(status)),
          ensureTool("rg", (status) => this.mode.display.status.showManagedToolStatus(status)),
        ]),
      );
      this.mode.input.autocomplete.fdPath = fdPath;

      this.mode.input.keys.setupKeyHandlers();
      this.mode.input.submit.setupEditorSubmitHandler();
      this.mode.ui.requestRender();

      yield* awaited(this.mode.extensions.binding.rebindCurrentSession());

      this.mode.view.history.renderInitialMessages();

      onThemeChange(() => {
        this.mode.ui.invalidate();
        this.mode.input.keys.updateEditorBorderColor();
        this.mode.ui.requestRender();
      });

      this.mode.layout.footerDataProvider.onBranchChange(() => {
        this.mode.ui.requestRender();
      });

      this.mode.models.selector.updateAvailableProviderCount();

      this.mode.ui.renderNow();
      Effect.runFork(
        awaitingWith(function* () {
          yield* awaited(loadAllHighlightLanguages());
          if (!this.isInitialized) return;
          this.mode.ui.invalidate();
          this.mode.ui.requestRender();
        }, this),
      );
    }, this);
  }
}
