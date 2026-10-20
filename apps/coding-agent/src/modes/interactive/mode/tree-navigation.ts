import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import clipboard from "../../../utils/clipboard.ts";
import errorsModule from "../../../utils/errors.ts";
import statusIndicators from "../components/status-indicators.ts";
import TreeSelectorComponent from "../components/tree-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { BranchSummaryStatusIndicator } = statusIndicators;
const { Spacer } = tuiModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { copyToClipboard } = clipboard;
const { toErrorMessage } = errorsModule;

export default class TreeNavigation {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private askBranchSummary(): Effect.Effect<
    { wantsSummary: boolean; customInstructions: string | undefined } | undefined
  > {
    return awaitingWith(function* () {
      if (this.mode.settingsManager.getBranchSummarySkipPrompt())
        return { customInstructions: undefined, wantsSummary: false };
      while (true) {
        const summaryChoice = yield* awaited(
          this.mode.extensions.dialogs.extensionDialogs.select("Summarize branch?", [
            "No summary",
            "Summarize",
            "Summarize with custom prompt",
          ]),
        );
        if (summaryChoice === undefined) return undefined;
        const wantsSummary = summaryChoice !== "No summary";
        if (summaryChoice !== "Summarize with custom prompt")
          return { customInstructions: undefined, wantsSummary };
        const customInstructions = yield* awaited(
          this.mode.extensions.dialogs.extensionDialogs.editor("Custom summarization instructions"),
        );
        if (customInstructions !== undefined) return { customInstructions, wantsSummary };
      }
    }, this);
  }

  private copyTreeSelection(text: string | undefined): Promise<void> {
    if (text === undefined || text === "") {
      this.mode.display.status.showError("Selected entry has no text to copy");
      return Promise.resolve();
    }
    return copyToClipboard(text).then(
      () => this.mode.display.status.showStatus("Copied selected message to clipboard"),
      (error: unknown) => this.mode.display.status.showError(toErrorMessage(error)),
    );
  }

  private showBranchSummaryIndicator(wantsSummary: boolean): {
    showingSummaryIndicator: boolean;
    originalOnEscape: (() => void) | undefined;
  } {
    let showingSummaryIndicator = false;
    const originalOnEscape = this.mode.defaultEditor.onEscape;

    if (wantsSummary) {
      this.mode.defaultEditor.onEscape = () => {
        this.mode.session.context.tree.abortBranchSummary();
      };
      this.mode.layout.chatContainer.addChild(new Spacer(1));
      this.mode.display.indicator.showStatusIndicator(
        new BranchSummaryStatusIndicator(this.mode.ui),
      );
      showingSummaryIndicator = true;
      this.mode.ui.requestRender();
    }
    return { originalOnEscape, showingSummaryIndicator };
  }

  navigateTreeFromExtension(
    targetId: string,
    options: Parameters<extensionsTypes.ExtensionCommandContextActions["navigateTree"]>[1],
  ) {
    return this.mode.session.context.tree
      .navigateTree(targetId, {
        customInstructions: options?.customInstructions,
        label: options?.label,
        replaceInstructions: options?.replaceInstructions,
        summarize: options?.summarize,
      })
      .then((result) => {
        if (result.cancelled) return { cancelled: true };
        this.mode.layout.chatContainer.clear();
        this.mode.view.history.renderInitialMessages();
        const editorText = result.editorText ?? "";
        if (editorText !== "" && this.mode.editor.getText().trim() === "")
          this.mode.editor.setText(editorText);
        this.mode.display.status.showStatus("Navigated to selected point");
        void this.mode.input.queue.flushCompactionQueue({ willRetry: false });
        return { cancelled: false };
      });
  }

  private navigateToTreeEntry(
    entryId: string,
    choice: { wantsSummary: boolean; customInstructions: string | undefined },
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { showingSummaryIndicator, originalOnEscape } = this.showBranchSummaryIndicator(
        choice.wantsSummary,
      );
      try {
        const result = yield* awaited(
          this.mode.session.context.tree.navigateTree(entryId, {
            customInstructions: choice.customInstructions,
            summarize: choice.wantsSummary,
          }),
        );
        if (result.aborted === true) {
          this.mode.display.status.showStatus("Branch summarization cancelled");
          this.showTreeSelector(entryId);
          return;
        }
        if (result.cancelled) {
          this.mode.display.status.showStatus("Navigation cancelled");
          return;
        }
        this.mode.layout.chatContainer.clear();
        this.mode.view.history.renderInitialMessages();
        const editorText = result.editorText ?? "";
        if (editorText !== "" && this.mode.editor.getText().trim() === "")
          this.mode.editor.setText(editorText);
        this.mode.display.status.showStatus("Navigated to selected point");
        void this.mode.input.queue.flushCompactionQueue({ willRetry: false });
      } catch (error) {
        this.mode.display.status.showError(toErrorMessage(error));
      } finally {
        if (showingSummaryIndicator)
          this.mode.display.indicator.clearStatusIndicator("branchSummary");
        this.mode.defaultEditor.onEscape = originalOnEscape;
      }
    }, this);
  }

  private onTreeEntrySelected(entryId: string, done: () => void): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        done();
        if (entryId === this.mode.sessionManager.getLeafId()) {
          this.mode.display.status.showStatus("Already at this point");
          return;
        }
        const choice = yield* performed(this.askBranchSummary());
        if (choice === undefined) {
          this.showTreeSelector(entryId);
          return;
        }
        if (this.mode.session.isStreaming) {
          this.mode.input.queue.restoreQueuedMessagesToEditor();
          yield* awaited(this.mode.session.run.lifecycle.abort());
        }
        if (this.mode.session.compaction.manual.isCompacting) {
          this.mode.display.status.showError(
            "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
          );
          return;
        }
        yield* performed(this.navigateToTreeEntry(entryId, choice));
      }, this),
    );
  }

  showTreeSelector(initialSelectedId?: string): void {
    const tree = this.mode.sessionManager.getTree();
    if (tree.length === 0) {
      this.mode.display.status.showStatus("No entries in session");
      return;
    }
    const realLeafId = this.mode.sessionManager.getLeafId();
    const initialFilterMode = this.mode.settingsManager.getTreeFilterMode();
    this.mode.editorSlot.showSelector((done) => {
      const selector = new TreeSelectorComponent(
        tree,
        realLeafId,
        this.mode.ui.terminal.rows,
        (entryId) => this.onTreeEntrySelected(entryId, done),
        () => {
          done();
          this.mode.ui.requestRender();
        },
        (entryId, label) => {
          this.mode.sessionManager.appendLabelChange(entryId, label);
          this.mode.ui.requestRender();
        },
        initialSelectedId,
        initialFilterMode,
      );
      selector.onCopy = (text) => this.copyTreeSelection(text);
      return { component: selector, focus: selector };
    });
  }
}
