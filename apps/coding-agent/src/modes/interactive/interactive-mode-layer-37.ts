import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import crashLog from "../../core/crash-log.ts";
import type crashLogTypes from "../../core/crash-log.types.ts";
import errorsModule from "../../utils/errors.ts";
import TreeSelectorComponent from "./components/tree-selector.ts";
import InteractiveModeLayer36 from "./interactive-mode-layer-36.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { takeUnnotifiedCrash } = crashLog;
const { toErrorMessage } = errorsModule;

export default abstract class InteractiveModeLayer37 extends InteractiveModeLayer36 {
  protected runCrash(): {
    crash: crashLogTypes.CrashRecord | undefined;
    initialMessage: string | undefined;
    initialImages: compatTypes.ImageContent[] | undefined;
    initialMessages: string[] | undefined;
  } {
    Effect.runFork(
      awaitingWith(function* () {
        const warning = yield* awaited(this.checkTmuxKeyboardSetup());
        if (warning !== undefined && warning !== "") {
          this.showWarning(warning);
        }
      }, this),
    );

    const {
      migratedProviders,
      startupDiagnostics,
      modelFallbackMessage,
      initialMessage,
      initialImages,
      initialMessages,
    } = this.options;

    for (const diagnostic of startupDiagnostics ?? []) {
      if (diagnostic.type === "error") {
        this.showError(diagnostic.message);
      } else if (diagnostic.type === "warning") {
        this.showWarning(diagnostic.message);
      } else {
        this.showStatus(diagnostic.message);
      }
    }

    if (migratedProviders !== undefined && migratedProviders.length > 0) {
      this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
    }

    const modelsJsonError = this.session.modelRuntime.getError();
    if (modelsJsonError !== undefined && modelsJsonError !== "") {
      this.showError(`models.json error: ${modelsJsonError}`);
    }

    if (modelFallbackMessage !== undefined && modelFallbackMessage !== "") {
      this.showWarning(modelFallbackMessage);
    }

    const crash = takeUnnotifiedCrash();
    return { crash, initialImages, initialMessage, initialMessages };
  }

  protected navigateToTreeEntry(
    entryId: string,
    choice: { wantsSummary: boolean; customInstructions: string | undefined },
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { showingSummaryIndicator, originalOnEscape } =
        this.showTreeSelectorShowingSummaryIndicator(choice.wantsSummary);
      try {
        const result = yield* awaited(
          this.session.navigateTree(entryId, {
            customInstructions: choice.customInstructions,
            summarize: choice.wantsSummary,
          }),
        );
        if (result.aborted === true) {
          this.showStatus("Branch summarization cancelled");
          this.showTreeSelector(entryId);
          return;
        }
        if (result.cancelled) {
          this.showStatus("Navigation cancelled");
          return;
        }
        this.chatContainer.clear();
        this.renderInitialMessages();
        const editorText = result.editorText ?? "";
        if (editorText !== "" && this.editor.getText().trim() === "")
          this.editor.setText(editorText);
        this.showStatus("Navigated to selected point");
        void this.flushCompactionQueue({ willRetry: false });
      } catch (error) {
        this.showError(toErrorMessage(error));
      } finally {
        if (showingSummaryIndicator) this.clearStatusIndicator("branchSummary");
        this.defaultEditor.onEscape = originalOnEscape;
      }
    }, this);
  }

  protected onTreeEntrySelected(entryId: string, done: () => void): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        done();
        if (entryId === this.sessionManager.getLeafId()) {
          this.showStatus("Already at this point");
          return;
        }
        const choice = yield* performed(this.askBranchSummary());
        if (choice === undefined) {
          this.showTreeSelector(entryId);
          return;
        }
        if (this.session.isStreaming) {
          this.restoreQueuedMessagesToEditor();
          yield* awaited(this.session.abort());
        }
        if (this.session.isCompacting) {
          this.showError(
            "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
          );
          return;
        }
        yield* performed(this.navigateToTreeEntry(entryId, choice));
      }, this),
    );
  }

  protected showTreeSelector(initialSelectedId?: string): void {
    const tree = this.sessionManager.getTree();
    if (tree.length === 0) {
      this.showStatus("No entries in session");
      return;
    }
    const realLeafId = this.sessionManager.getLeafId();
    const initialFilterMode = this.settingsManager.getTreeFilterMode();
    this.editorSlot.showSelector((done) => {
      const selector = new TreeSelectorComponent(
        tree,
        realLeafId,
        this.ui.terminal.rows,
        (entryId) => this.onTreeEntrySelected(entryId, done),
        () => {
          done();
          this.ui.requestRender();
        },
        (entryId, label) => {
          this.sessionManager.appendLabelChange(entryId, label);
          this.ui.requestRender();
        },
        initialSelectedId,
        initialFilterMode,
      );
      selector.onCopy = (text) => this.copyTreeSelection(text);
      return { component: selector, focus: selector };
    });
  }
}
