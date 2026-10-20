import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import slashCommandsModule from "../../core/slash-commands.ts";
import emptyEnterBurstModule from "./empty-enter-burst.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer45 from "./interactive-mode-layer-45.ts";

const { awaitingWith, performed } = awaitingModule;
const { INIT_PROMPT, canonicalizeBuiltinSlashCommand, handoffPrompt, parseHandoffCommand } =
  slashCommandsModule;
const { EMPTY_ENTER_BURST_IDLE } = emptyEnterBurstModule;
const { promiseCommand, syncCommand } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer46 extends InteractiveModeLayer45 {
  protected builtinSessionCommands(): Record<string, interactiveModeInternalTypes.BuiltinCommand> {
    const entry = (clearFirst: boolean, run: () => Effect.Effect<void>) => ({
      args: false,
      clearFirst,
      run,
    });
    return {
      "/branch": entry(
        true,
        promiseCommand(() => this.handleCloneCommand()),
      ),
      "/clear": entry(true, () => this.handleClearCommand()),
      "/copy": entry(
        false,
        promiseCommand(() => this.handleCopyCommand()),
      ),
      "/exit": entry(
        true,
        promiseCommand(() => this.shutdown()),
      ),
      "/reload": entry(
        true,
        promiseCommand(() => this.handleReloadCommand()),
      ),
      "/scoped-models": entry(
        true,
        syncCommand(() => this.showModelsSelector()),
      ),
      "/share": entry(false, () => this.handleShareCommand()),
      "/status": entry(
        true,
        promiseCommand(() => this.handleSessionCommand()),
      ),
    };
  }

  protected handleBuiltinCommand(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const space = text.indexOf(" ");
      const name = space === -1 ? text : text.slice(0, space);
      const commands = {
        ...this.builtinViewCommands(),
        ...this.builtinSessionCommands(),
        ...this.builtinArgumentCommands(),
      };
      const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
      if (command === undefined || (space !== -1 && !command.args)) return false;
      if (command.clearFirst) this.editor.setText("");
      yield* performed(command.run(text));
      if (!command.clearFirst) this.editor.setText("");
      return true;
    }, this);
  }

  protected resolveSlashInput(text: string): Effect.Effect<string | undefined> {
    return awaitingWith(function* () {
      if (!text.startsWith("/") || this.isSkillCommand(text)) return text;
      const canonical = canonicalizeBuiltinSlashCommand(text);
      if (canonical === "/init") return INIT_PROMPT;
      const handoff = parseHandoffCommand(canonical);
      if (handoff !== undefined) {
        if (this.session.integrations.orchestration.orchestrator !== undefined)
          return handoffPrompt(handoff.path);
        this.showWarning("/handoff needs the orchestrator, which this session does not have");
        this.editor.setText("");
        return undefined;
      }
      if (yield* performed(this.handleBuiltinCommand(canonical))) return undefined;
      return canonical;
    }, this);
  }

  protected submitEditorText(submitted: string): Effect.Effect<void> {
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
      this.flushPendingBashComponents();
      if (this.onInputCallback === undefined) this.pendingUserInputs.push(text);
      else this.onInputCallback(text);
      this.editor.addToHistory?.(text);
    }, this);
  }

  protected setupEditorSubmitHandler(): void {
    this.defaultEditor.onSubmit = (text: string) => Effect.runPromise(this.submitEditorText(text));
  }
}
