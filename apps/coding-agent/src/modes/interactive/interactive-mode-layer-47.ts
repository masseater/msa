import tuiModule from "@msa/tui";
import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import syntaxHighlight from "../../utils/syntax-highlight.ts";
import toolsManager from "../../utils/tools-manager.ts";
import InteractiveModeLayer46 from "./interactive-mode-layer-46.ts";
import themeModule from "./theme/theme.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { Text } = tuiModule;
const { ensureTool } = toolsManager;
const { onThemeChange } = themeModule;
const { loadAllHighlightLanguages } = syntaxHighlight;

export default abstract class InteractiveModeLayer47 extends InteractiveModeLayer46 {
  init(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isInitialized) return;

        const startupVisibility = this.initStartupVisibility();
        yield* performed(this.initPart2());

        if (startupVisibility.header) {
          const { showDetails, withWordmark, compactInstructions, expandedInstructions } =
            this.initShowDetails(startupVisibility);
          this.initPart4(showDetails, withWordmark, compactInstructions, expandedInstructions);
        } else {
          this.builtInHeader = new Text("", 0, 0);
          this.headerContainer.addChild(this.builtInHeader);
        }
        yield* performed(this.initPart5());
      }, this),
    );
  }

  protected initPart5(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.ui.requestRender();

      const [fdPath] = yield* awaited(
        Promise.all([
          ensureTool("fd", (status) => this.showManagedToolStatus(status)),
          ensureTool("rg", (status) => this.showManagedToolStatus(status)),
        ]),
      );
      this.fdPath = fdPath;

      this.setupKeyHandlers();
      this.setupEditorSubmitHandler();
      this.ui.requestRender();

      yield* awaited(this.rebindCurrentSession());

      this.renderInitialMessages();

      onThemeChange(() => {
        this.ui.invalidate();
        this.updateEditorBorderColor();
        this.ui.requestRender();
      });

      this.footerDataProvider.onBranchChange(() => {
        this.ui.requestRender();
      });

      this.updateAvailableProviderCount();

      this.ui.renderNow();
      Effect.runFork(
        awaitingWith(function* () {
          yield* awaited(loadAllHighlightLanguages());
          if (!this.isInitialized) return;
          this.ui.invalidate();
          this.ui.requestRender();
        }, this),
      );
    }, this);
  }

  protected rebindCurrentSession(options: { renderBeforeBind?: boolean } = {}): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const session = this.session;

        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.programStatus.reset();
        this.applyRuntimeSettings();

        if (options.renderBeforeBind === true) {
          this.renderCurrentSessionState();
          this.subscribeToAgent();
        }

        yield* awaited(this.bindCurrentSessionExtensions());

        if (this.session !== session) {
          return;
        }

        if (options.renderBeforeBind !== true) {
          this.subscribeToAgent();
        }

        this.updateAvailableProviderCount();
        this.updateEditorBorderColor();
        this.updateTerminalTitle();
      }, this),
    );
  }

  protected subscribeToAgent(): void {
    this.unsubscribe = this.session.subscribe((event) =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.handleEvent(event));
        }, this),
      ),
    );
  }

  protected handleEvent(event: agentSessionTypes.AgentSessionEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (!this.isInitialized) yield* awaited(this.init());
        this.footer.invalidate();
        this.programStatus.handleEvent(event);
        if (this.handleStreamEvent(event)) return;
        yield* performed(this.handleSessionEvent(event));
      }, this),
    );
  }
}
