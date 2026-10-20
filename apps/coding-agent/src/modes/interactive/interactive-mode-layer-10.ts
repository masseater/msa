import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import modelResolver from "../../core/model-resolver.ts";
import bugReport from "./bug-report.ts";
import externalEditor from "./external-editor.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer9 from "./interactive-mode-layer-9.ts";
import themeModule from "./theme/theme.ts";

const { getEditorTheme, theme } = themeModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { editInExternalEditor } = externalEditor;
const { resolveModelScopeFromModels } = modelResolver;
const { reportBug } = bugReport;

export default abstract class InteractiveModeLayer10 extends InteractiveModeLayer9 {
  protected setCustomEditorComponent(factory: extensionsTypes.EditorFactory | undefined): void {
    this.editorComponentFactory = factory;

    const currentText = this.editor.getText();

    this.editorSlot.disposeActiveSelector();

    if (factory === undefined) {
      this.defaultEditor.setText(currentText);
      this.editor = this.defaultEditor;
    } else {
      const { customEditor, newEditor } = this.setCustomEditorComponentCustomEditor(
        factory,
        currentText,
      );
      this.setCustomEditorComponentPart2(customEditor, newEditor);
    }

    if (this.activeStatusIndicator !== undefined) {
      this.statusContainer.clear();
      this.activeWorkingIndicatorEmbedded = this.setEditorWorkingStatusIndicator(
        this.activeStatusIndicator,
      );
      if (!this.activeWorkingIndicatorEmbedded) {
        this.statusContainer.addChild(this.activeStatusIndicator);
      }
    }
    this.editorSlot.show(this.editor);
  }

  protected setCustomEditorComponentCustomEditor(
    factory: extensionsTypes.EditorFactory,
    currentText: string,
  ): { customEditor: Record<string, unknown>; newEditor: tuiTypes.EditorComponent } {
    const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

    if (this.defaultEditor.onSubmit !== undefined) newEditor.onSubmit = this.defaultEditor.onSubmit;
    if (this.defaultEditor.onChange !== undefined) newEditor.onChange = this.defaultEditor.onChange;

    newEditor.setText(currentText);

    if (newEditor.borderColor !== undefined) {
      newEditor.borderColor = this.defaultEditor.borderColor;
    }
    if (newEditor.setPaddingX !== undefined) {
      newEditor.setPaddingX(this.defaultEditor.getPaddingX());
    }
    if (newEditor.setAutocompleteMaxVisible !== undefined) {
      newEditor.setAutocompleteMaxVisible(this.defaultEditor.getAutocompleteMaxVisible());
    }

    if (
      newEditor.setAutocompleteProvider !== undefined &&
      this.autocompleteProvider !== undefined
    ) {
      newEditor.setAutocompleteProvider(this.autocompleteProvider);
    }

    const customEditor = newEditor as unknown as Record<string, unknown>;
    return { customEditor, newEditor };
  }

  protected submitBashInput(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (!text.startsWith("!")) return false;
      const isExcluded = text.startsWith("!!");
      const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
      if (command === "") return false;
      if (this.session.isBashRunning) {
        this.showWarning("A bash command is already running. Press Esc to cancel it first.");
        this.editor.setText(text);
        return true;
      }
      this.editor.addToHistory?.(text);
      yield* awaited(this.handleBashCommand(command, isExcluded));
      this.isBashMode = false;
      this.updateEditorBorderColor();
      return true;
    }, this);
  }

  protected handleOpenExternalEditor(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const editorCmd = this.settingsManager.getExternalEditorCommand();
      const content = this.editor.getExpandedText?.() ?? this.editor.getText();
      this.ui.stop();
      try {
        const result = yield* awaited(
          editInExternalEditor({
            command: editorCmd,
            content,
          }),
        );
        if (result.status === "complete") {
          this.editor.setText(result.content);
        }
      } finally {
        this.ui.start();
        this.ui.requestRender(true);
      }
    }, this);
  }

  protected flushCompactionQueueRest(
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[],
    firstPromptIndex: number,
    firstPrompt: interactiveModeInternalTypes.CompactionQueuedMessage,
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<{
    rest: interactiveModeInternalTypes.CompactionQueuedMessage[];
    promptPromise: Promise<void>;
  }> {
    return awaitingWith(function* () {
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        yield* awaited(this.session.prompt(message.text));
      }

      const promptPromise = this.session
        .prompt(firstPrompt.text, { streamingBehavior: firstPrompt.mode })
        .catch((error) => {
          restoreQueue(error);
        });
      return { promptPromise, rest };
    }, this);
  }

  protected applyScopedModelSelection(
    state: interactiveModeInternalTypes.ScopedModelsState,
    enabledIds: string[] | null,
  ): void {
    state.currentEnabledIds = enabledIds === null ? null : [...enabledIds];
    const { availableModelIds } = state;
    const hasEnabledAvailableModel = enabledIds?.some((id) => availableModelIds.has(id)) ?? false;
    const allAvailableModelsEnabled =
      enabledIds !== null && [...availableModelIds].every((id) => enabledIds.includes(id));
    if (enabledIds !== null && hasEnabledAvailableModel && !allAvailableModelsEnabled) {
      const { scopedModels } = resolveModelScopeFromModels(enabledIds, state.availableModels);
      this.session.setScopedModels(
        scopedModels.map((scoped) => ({
          model: scoped.model,
          thinkingLevel: scoped.thinkingLevel,
        })),
      );
    } else this.session.setScopedModels([]);
    this.updateAvailableProviderCount();
    this.ui.requestRender();
  }

  protected handleExportCommand(text: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const outputPath = this.getPathCommandArgument(text, "/export");

      try {
        const filePath =
          outputPath?.endsWith(".jsonl") === true
            ? this.session.exportToJsonl(outputPath)
            : yield* awaited(
                this.session.exportToHtml(outputPath, {
                  themeName: theme.name,
                }),
              );
        this.showStatus(`Session exported to: ${filePath}`);
      } catch (error: unknown) {
        this.showError(
          `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }, this);
  }

  protected handleBugCommand(hint: string | undefined): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(
        reportBug(
          {
            editorSlot: this.editorSlot,
            keybindings: this.keybindings,
            session: this.session,
            showError: (message) => this.showError(message),
            showStatus: (message) => this.showStatus(message),
            ui: this.ui,
          },
          hint,
        ),
      );
    }, this);
  }

  protected runBashCommand(
    command: string,
    excludeFromContext: boolean,
    operations: extensionsTypes.UserBashEventResult["operations"],
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mountBashComponent(command, excludeFromContext);
      this.ui.requestRender();
      try {
        const onChunk = (chunk: string) => {
          if (this.bashComponent === undefined) return;
          this.bashComponent.appendOutput(chunk);
          this.ui.requestRender();
        };
        const result = yield* awaited(
          this.session.executeBash(command, onChunk, { excludeFromContext, operations }),
        );
        this.completeBashComponent(result);
      } catch (error) {
        this.bashComponent?.setComplete(undefined, false);
        this.showError(
          `Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
      this.bashComponent = undefined;
      this.ui.requestRender();
    }, this);
  }

  protected handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let eventResult: extensionsTypes.UserBashEventResult | undefined;
        try {
          eventResult = yield* awaited(
            this.session.extensionRunner.emitUserBash({
              command,
              cwd: this.sessionManager.getCwd(),
              excludeFromContext,
              type: "user_bash",
            }),
          );
        } catch {
          return;
        }
        if (eventResult?.result !== undefined) {
          this.showExtensionBashResult(command, eventResult.result, excludeFromContext);
          return;
        }
        yield* performed(this.runBashCommand(command, excludeFromContext, eventResult?.operations));
      }, this),
    );
  }

  protected handleCompactCommand(customInstructions?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.clearStatusIndicator();

      try {
        yield* awaited(this.session.compact(customInstructions));
      } catch {}
    }, this);
  }
}
