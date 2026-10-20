import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import awaitingModule from "../awaiting.ts";
import type goalTypes from "../goal.types.ts";
import memoryFormat from "../memory/memory-format.ts";
import type memoryTypes from "../memory/memory.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { formatMemoryList, formatSearchResults } = memoryFormat;

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
        text = "Memory is disabled (settings: memory.enabled).";
      } else {
        switch (command.kind) {
          case "status":
            text = memory.describeStatus();
            break;
          case "stats":
            text = memory.describeStats();
            break;
          case "list":
            text = formatMemoryList(memory.list(20));
            break;
          case "search":
            text = formatSearchResults(yield* awaited(memory.search(command.query, 10)));
            break;
          case "forget":
            text = memory.forget(command.id)
              ? `Forgot memory ${command.id}.`
              : `No memory with id ${command.id}.`;
            break;
        }
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
