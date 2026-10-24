import * as Effect from "effect/Effect";

import errors from "../../utils/errors.ts";
import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import ask from "../ask.ts";
import awaitingModule from "../awaiting.ts";
import goalModule from "../goal.ts";
import memoryCommandModule from "../memory/memory-command.ts";
const { parseGoalCommand } = goalModule;
const { parseAskCommand } = ask;
const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errors;
const { parseMemoryCommand } = memoryCommandModule;

export default class SessionCommands {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  throwIfExtensionCommand(text: string): void {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const command = this.session.extensions.binding.extensionRunnerInternal.getCommand(commandName);

    if (command !== undefined && !this.session.commands.slash.isSkillCommand(text)) {
      throw new Error(
        `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
      );
    }
  }

  private tryExecuteExtensionCommand(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const spaceIndex = text.indexOf(" ");
      const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
      const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

      const command =
        this.session.extensions.binding.extensionRunnerInternal.getCommand(commandName);
      if (command === undefined || this.session.commands.slash.isSkillCommand(text)) return false;

      const ctx = this.session.extensions.binding.extensionRunnerInternal.createCommandContext();

      try {
        yield* awaited(command.handler(args, ctx));
        return true;
      } catch (err) {
        this.session.extensions.binding.extensionRunnerInternal.emitError({
          error: toErrorMessage(err),
          event: "command",
          extensionPath: `command:${commandName}`,
        });
        return true;
      }
    }, this);
  }

  runPromptCommand(
    text: string,
    options: agentSessionTypes.PromptOptions | undefined,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (!(options?.expandPromptTemplates ?? true)) return false;
      const goalCommand = parseGoalCommand(text);
      if (goalCommand !== undefined) {
        yield* performed(this.session.commands.builtin.runGoalCommand(goalCommand, options));
        return true;
      }
      const askCommand = parseAskCommand(text);
      if (askCommand !== undefined) {
        if (askCommand.question === "") throw new Error("Usage: /ask <question>");
        yield* awaited(
          this.session.run.prompting.prompt(askCommand.question, {
            ...options,
            expandPromptTemplates: false,
            mode: "ask",
          }),
        );
        return true;
      }
      const memoryCommand = parseMemoryCommand(text);
      if (memoryCommand !== undefined) {
        yield* performed(this.session.commands.builtin.runMemoryCommand(memoryCommand, options));
        return true;
      }
      if (!text.startsWith("/") || !(yield* performed(this.tryExecuteExtensionCommand(text))))
        return false;
      options?.preflightResult?.("handled");
      return true;
    }, this);
  }
}
