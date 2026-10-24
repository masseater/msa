import * as Effect from "effect/Effect";

import errorsModule from "../../utils/errors.ts";
import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import awaitingModule from "../awaiting.ts";
import type goalTypes from "../goal.types.ts";
import type memoryTypes from "../memory/memory.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;

export default class SessionBuiltinCommands {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  runMemoryCommand(
    command: memoryTypes.MemoryCommand,
    options?: agentSessionTypes.PromptOptions,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const memory = this.session.integrations.memory.memoryInternal;
      let text: string;
      if (memory === undefined) {
        text = "Memory is off (settings: memory.enabled).";
      } else if (command.kind === "status") {
        text = memory.status(yield* awaited(memory.legacyPending()));
      } else {
        text = yield* awaited(
          memory.send(command.request).then(
            (reply) => (reply === "" ? "sepiace returned nothing." : reply),
            (error: unknown) => toErrorMessage(error),
          ),
        );
      }
      this.session.emit({ text, type: "memory_status" });
      options?.preflightResult?.("handled");
    }, this);
  }

  runGoalCommand(
    command: goalTypes.GoalCommand,
    options?: agentSessionTypes.PromptOptions,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (command.kind === "set") {
        this.session.integrations.goal.goalInternal.set(command.condition);
        const goal = this.session.integrations.goal.goalInternal.snapshot;
        if (goal === undefined) return;
        yield* awaited(
          this.session.run.prompting.prompt(goal.condition, {
            ...options,
            expandPromptTemplates: false,
            streamingBehavior: options?.streamingBehavior ?? "steer",
          }),
        );
        return;
      }
      if (command.kind === "status" || !this.session.integrations.goal.goalInternal.clear()) {
        this.session.emit({
          goal: this.session.integrations.goal.goalInternal.snapshot,
          type: "goal_status",
        });
      }
      options?.preflightResult?.("handled");
    }, this);
  }
}
