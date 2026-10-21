import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import platform from "../../../core/platform/index.ts";
import slashCommandsModule from "../../../core/slash-commands.ts";
import emptyEnterBurstModule from "../empty-enter-burst.ts";
import type emptyEnterBurstTypes from "../empty-enter-burst.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { EMPTY_ENTER_BURST_IDLE, registerEmptyEnter } = emptyEnterBurstModule;
const { INIT_PROMPT, canonicalizeBuiltinSlashCommand, handoffPrompt, parseHandoffCommand } =
  slashCommandsModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { nowMs } = platform;

export default class EditorSubmission {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private emptyEnterBurst: emptyEnterBurstTypes.EmptyEnterBurst = EMPTY_ENTER_BURST_IDLE;

  private onInputCallback?: ((text: string) => void) | undefined;

  private pendingUserInputs: string[] = [];

  handleStartupSubmit(text: string): void {
    this.mode.editor.setText(text);
    this.mode.display.status.showStatus("Startup is still in progress");
  }

  promptReportingErrors(
    text: string,
    options?: { images?: compatTypes.ImageContent[] | undefined },
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        yield* awaited(this.mode.session.run.prompting.prompt(text, options));
      } catch (error: unknown) {
        this.mode.display.status.showError(
          error instanceof Error ? error.message : "Unknown error occurred",
        );
      }
    }, this);
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

  handleEmptyEnter(): void {
    const { burst, fire } = registerEmptyEnter(this.emptyEnterBurst, nowMs());
    this.emptyEnterBurst = burst;
    if (!fire) return;
    const sent = this.mode.session.run.queue.flushQueue();
    if (sent === 0) return;
    this.mode.display.status.showStatus(`Sent ${sent} queued message${sent > 1 ? "s" : ""}`);
  }

  private submitBashInput(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (!text.startsWith("!")) return false;
      const isExcluded = text.startsWith("!!");
      const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
      if (command === "") return false;
      if (this.mode.session.context.bash.isBashRunning) {
        this.mode.display.status.showWarning(
          "A bash command is already running. Press Esc to cancel it first.",
        );
        this.mode.editor.setText(text);
        return true;
      }
      this.mode.editor.addToHistory?.(text);
      yield* awaited(this.mode.input.bash.handleBashCommand(command, isExcluded));
      this.mode.input.bash.isBashMode = false;
      this.mode.input.keys.updateEditorBorderColor();
      return true;
    }, this);
  }

  private submitWhileBusy(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (this.mode.session.compaction.manual.isCompacting) {
        if (this.mode.input.queue.isExtensionCommand(text)) {
          this.mode.editor.addToHistory?.(text);
          this.mode.editor.setText("");
          yield* awaited(this.mode.session.run.prompting.prompt(text));
        } else this.mode.input.queue.queueCompactionMessage(text, "steer");
        return true;
      }
      if (!this.mode.session.isStreaming) return false;
      this.mode.editor.addToHistory?.(text);
      this.mode.editor.setText("");
      yield* awaited(this.mode.session.run.prompting.prompt(text, { streamingBehavior: "steer" }));
      this.mode.input.queue.updatePendingMessagesDisplay();
      this.mode.ui.requestRender();
      return true;
    }, this);
  }

  handleFollowUp(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const text = (this.mode.editor.getExpandedText?.() ?? this.mode.editor.getText()).trim();
      if (text === "") return;

      if (this.mode.session.compaction.manual.isCompacting) {
        if (this.mode.input.queue.isExtensionCommand(text)) {
          this.mode.editor.addToHistory?.(text);
          this.mode.editor.setText("");
          yield* awaited(this.mode.session.run.prompting.prompt(text));
        } else {
          this.mode.input.queue.queueCompactionMessage(text, "followUp");
        }
        return;
      }

      if (this.mode.session.isStreaming) {
        this.mode.editor.addToHistory?.(text);
        this.mode.editor.setText("");
        yield* awaited(
          this.mode.session.run.prompting.prompt(text, { streamingBehavior: "followUp" }),
        );
        this.mode.input.queue.updatePendingMessagesDisplay();
        this.mode.ui.requestRender();
      } else if (this.mode.editor.onSubmit !== undefined) {
        this.mode.editor.setText("");
        this.mode.editor.onSubmit(text);
      }
    }, this);
  }

  private resolveSlashInput(text: string): Effect.Effect<string | undefined> {
    return awaitingWith(function* () {
      if (!text.startsWith("/") || this.mode.input.autocomplete.isSkillCommand(text)) return text;
      const canonical = canonicalizeBuiltinSlashCommand(text);
      if (canonical === "/init") return INIT_PROMPT;
      const handoff = parseHandoffCommand(canonical);
      if (handoff !== undefined) {
        if (this.mode.session.integrations.orchestration.orchestrator !== undefined)
          return handoffPrompt(handoff.path);
        this.mode.display.status.showWarning(
          "/handoff needs the orchestrator, which this session does not have",
        );
        this.mode.editor.setText("");
        return undefined;
      }
      if (yield* performed(this.mode.commands.router.handleBuiltinCommand(canonical)))
        return undefined;
      return canonical;
    }, this);
  }

  private submitEditorText(submitted: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const trimmed = submitted.trim();
      if (trimmed === "") {
        this.handleEmptyEnter();
        return;
      }
      this.emptyEnterBurst = EMPTY_ENTER_BURST_IDLE;
      const text = yield* performed(this.resolveSlashInput(trimmed));
      if (text === undefined) return;
      if (yield* performed(this.submitBashInput(text))) return;
      if (yield* performed(this.submitWhileBusy(text))) return;
      this.mode.input.bash.flushPendingBashComponents();
      if (this.onInputCallback === undefined) this.pendingUserInputs.push(text);
      else this.onInputCallback(text);
      this.mode.editor.addToHistory?.(text);
    }, this);
  }

  setupEditorSubmitHandler(): void {
    this.mode.defaultEditor.onSubmit = (text: string) =>
      Effect.runPromise(this.submitEditorText(text));
  }
}
