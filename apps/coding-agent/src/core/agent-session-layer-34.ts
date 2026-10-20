import * as Effect from "effect/Effect";

import AgentSessionLayer33 from "./agent-session-layer-33.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import ask from "./ask.ts";
import authGuidance from "./auth-guidance.ts";
import awaitingModule from "./awaiting.ts";
import goalModule from "./goal.ts";
import type goalTypes from "./goal.types.ts";
import memoryFormat from "./memory/memory-format.ts";
import promptTemplatesModule from "./prompt-templates.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { parseGoalCommand } = goalModule;
const { parseAskCommand } = ask;
const { parseMemoryCommand } = memoryFormat;
const { expandPromptTemplate } = promptTemplatesModule;
const { formatNoModelSelectedMessage } = authGuidance;

export default abstract class AgentSessionLayer34 extends AgentSessionLayer33 {
  protected runPromptCommand(
    text: string,
    options: agentSessionTypes.PromptOptions | undefined,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (!(options?.expandPromptTemplates ?? true)) return false;
      const goalCommand = parseGoalCommand(text);
      if (goalCommand !== undefined) {
        yield* performed(this.runGoalCommand(goalCommand, options));
        return true;
      }
      const askCommand = parseAskCommand(text);
      if (askCommand !== undefined) {
        if (askCommand.question === "") throw new Error("Usage: /ask <question>");
        yield* awaited(
          this.prompt(askCommand.question, {
            ...options,
            expandPromptTemplates: false,
            mode: "ask",
          }),
        );
        return true;
      }
      const memoryCommand = parseMemoryCommand(text);
      if (memoryCommand !== undefined) {
        yield* performed(this.runMemoryCommand(memoryCommand, options));
        return true;
      }
      if (!text.startsWith("/") || !(yield* performed(this.tryExecuteExtensionCommand(text))))
        return false;
      options?.preflightResult?.("handled");
      return true;
    }, this);
  }

  prompt(text: string, options?: agentSessionTypes.PromptOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isEmittingAgentSettled) {
          this.deferredSettledActions.push(() => this.prompt(text, options));
          return;
        }
        if (yield* performed(this.runPromptCommand(text, options))) return;
        if (this.compactionAbortController !== undefined) {
          throw new Error(
            "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
          );
        }
        const processedInput = yield* performed(
          this.runInputHandlers(
            text,
            options?.images,
            options?.source ?? "interactive",
            this.isStreaming ? options?.streamingBehavior : undefined,
          ),
        );
        if (processedInput === undefined) {
          options?.preflightResult?.("handled");
          return;
        }
        const { text: currentText, images: currentImages } = processedInput;
        const expandedText =
          (options?.expandPromptTemplates ?? true)
            ? expandPromptTemplate(this.expandSkillCommand(currentText), [...this.promptTemplates])
            : currentText;
        if (this.isStreaming) {
          yield* performed(this.queueWhileStreaming(expandedText, currentImages, options));
          return;
        }
        const model = this.model;
        if (model === undefined) throw new Error(formatNoModelSelectedMessage());
        yield* performed(this.ensurePromptAuth(model));
        yield* performed(
          this.startRun(
            { images: currentImages, messageType: "user", prompt: expandedText },
            () => options?.preflightResult?.("started"),
            options?.mode,
          ),
        );
      }, this),
    );
  }

  protected runGoalCommand(
    command: goalTypes.GoalCommand,
    options?: agentSessionTypes.PromptOptions,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (command.kind === "set") {
        this.goalInternal.set(command.condition);
        const goal = this.goalInternal.snapshot;
        if (goal === undefined) return;
        yield* awaited(
          this.prompt(goal.condition, {
            ...options,
            expandPromptTemplates: false,
            streamingBehavior: options?.streamingBehavior ?? "steer",
          }),
        );
        return;
      }
      if (command.kind === "status" || !this.goalInternal.clear()) {
        this.emit({ goal: this.goalInternal.snapshot, type: "goal_status" });
      }
      options?.preflightResult?.("handled");
    }, this);
  }
}
