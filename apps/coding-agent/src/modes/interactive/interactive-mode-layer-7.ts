import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import clipboard from "../../utils/clipboard.ts";
import errorsModule from "../../utils/errors.ts";
import expandableTextSupport from "./components/expandable-text-support.ts";
import ExtensionDialogs from "./extension-dialogs.ts";
import InteractiveModeLayer6 from "./interactive-mode-layer-6.ts";
import sessionShare from "./session-share.ts";

const { awaited, awaitingWith } = awaitingModule;
const { copyToClipboard, readClipboardText } = clipboard;
const { toErrorMessage } = errorsModule;
const { isExpandable } = expandableTextSupport;
const { shareSession } = sessionShare;

export default abstract class InteractiveModeLayer7 extends InteractiveModeLayer6 {
  protected readonly onRightClickPaste = (): void => {
    void void this.handleRightClickPaste();
  };

  protected createExtensionDialogs() {
    return new ExtensionDialogs({
      editorSlot: this.editorSlot,
      getExternalEditorCommand: () => this.settingsManager.getExternalEditorCommand(),
      keybindings: this.keybindings,
      programStatus: this.programStatus,
      toggleToolsExpanded: () => this.toggleToolOutputExpansion(),
      ui: this.ui,
    });
  }

  protected promptReportingErrors(
    text: string,
    options?: { images?: compatTypes.ImageContent[] | undefined },
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        yield* awaited(this.session.run.prompting.prompt(text, options));
      } catch (error: unknown) {
        this.showError(error instanceof Error ? error.message : "Unknown error occurred");
      }
    }, this);
  }

  protected handleRightClickPaste(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const target = this.renderer.getFocusedComponent();
        const handleInput = target?.handleInput;
        if (target === null || handleInput === undefined) return;
        try {
          const text = yield* awaited(readClipboardText());
          if (text === null || text === "" || this.renderer.getFocusedComponent() !== target)
            return;
          handleInput.call(target, `\x1b[200~${text}\x1b[201~`);
          this.ui.requestRender();
        } catch {}
      }, this),
    );
  }

  getUserInput(): Promise<string> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const queuedInput = this.pendingUserInputs.shift();
        if (queuedInput !== undefined) {
          return Effect.succeed(queuedInput);
        }

        return Effect.callback<string>((resume) => {
          this.onInputCallback = (text: string) => {
            this.onInputCallback = undefined;
            resume(Effect.succeed(text));
          };
        });
      }),
    );
  }

  protected cycleModel(direction: "forward" | "backward"): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        const result = yield* awaited(this.session.models.selection.cycleModel(direction));
        if (result === undefined) {
          const msg =
            this.session.models.selection.scopedModels.length > 0
              ? "Only one model in scope"
              : "Only one model available";
          this.showStatus(msg);
        } else {
          this.footer.invalidate();
          this.updateEditorBorderColor();
          const thinkingStr =
            result.model.reasoning && result.thinkingLevel !== "off"
              ? ` (thinking: ${result.thinkingLevel})`
              : "";
          this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
        }
      } catch (error) {
        this.showError(toErrorMessage(error));
      }
    }, this);
  }

  protected toggleToolOutputExpansion(): void {
    this.setToolsExpanded(!this.toolOutputExpanded);
  }

  protected setToolsExpanded(expanded: boolean): void {
    if (expanded === this.toolOutputExpanded) return;

    this.toolOutputExpanded = expanded;
    const activeHeader = this.customHeader ?? this.builtInHeader;
    if (isExpandable(activeHeader)) {
      activeHeader.setExpanded(expanded);
    }
    for (const container of [this.loadedResourcesContainer, this.chatContainer]) {
      for (const child of container.children) {
        if (isExpandable(child)) {
          child.setExpanded(expanded);
        }
      }
    }
    this.showStatus(`Tool output: ${expanded ? "expanded" : "collapsed"}`);
  }

  protected selectThinkingLevel(level: agentTypes.ThinkingLevel, persist: boolean): void {
    try {
      this.session.models.thinking.setThinkingLevel(level, { persist });
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(persist ? `Default thinking level: ${level}` : `Thinking level: ${level}`);
    } catch (error) {
      this.showError(toErrorMessage(error));
    }
  }

  protected selectModelFromSelector(
    model: compatTypes.Model<any>,
    persist: boolean,
    done: () => void,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          yield* awaited(this.session.models.selection.setModel(model, { persist }));
          this.updateAvailableProviderCount();
          this.footer.invalidate();
          this.updateEditorBorderColor();
          done();
          this.showStatus(
            persist ? `Default model: ${model.provider}/${model.id}` : `Model: ${model.id}`,
          );
        } catch (error) {
          done();
          this.showError(toErrorMessage(error));
        }
      }, this),
    );
  }

  protected handleCloneCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const leafId = this.sessionManager.getLeafId();
        if (leafId === null || leafId === "") {
          this.showStatus("Nothing to clone yet");
          return;
        }

        try {
          const result = yield* awaited(this.runtimeHost.fork(leafId, { position: "at" }));
          if (result.cancelled) {
            this.ui.requestRender();
            return;
          }

          this.editor.setText("");
          this.showStatus("Cloned to new session");
        } catch (error: unknown) {
          this.showError(toErrorMessage(error));
        }
      }, this),
    );
  }

  protected askBranchSummary(): Effect.Effect<
    { wantsSummary: boolean; customInstructions: string | undefined } | undefined
  > {
    return awaitingWith(function* () {
      if (this.settingsManager.getBranchSummarySkipPrompt())
        return { customInstructions: undefined, wantsSummary: false };
      while (true) {
        const summaryChoice = yield* awaited(
          this.extensionDialogs.select("Summarize branch?", [
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
          this.extensionDialogs.editor("Custom summarization instructions"),
        );
        if (customInstructions !== undefined) return { customInstructions, wantsSummary };
      }
    }, this);
  }

  protected copyTreeSelection(text: string | undefined): Promise<void> {
    if (text === undefined || text === "") {
      this.showError("Selected entry has no text to copy");
      return Promise.resolve();
    }
    return copyToClipboard(text).then(
      () => this.showStatus("Copied selected message to clipboard"),
      (error: unknown) => this.showError(toErrorMessage(error)),
    );
  }

  protected importSession(inputPath: string, cwd?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const result = yield* awaited(
        cwd === undefined
          ? this.runtimeHost.importFromJsonl(inputPath)
          : this.runtimeHost.importFromJsonl(inputPath, cwd),
      );
      this.showStatus(
        result.cancelled ? "Import cancelled" : `Session imported from: ${inputPath}`,
      );
    }, this);
  }

  protected handleShareCommand(): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(
        shareSession({
          editorSlot: this.editorSlot,
          session: this.session,
          showError: (message) => this.showError(message),
          showStatus: (message) => this.showStatus(message),
          ui: this.ui,
        }),
      );
    }, this);
  }
}
