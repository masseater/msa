import compat from "@msa/ai/compat";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import GoalLoop from "../goal-loop.ts";
import goalModule from "../goal.ts";
import type goalTypes from "../goal.types.ts";
import platform from "../platform/index.ts";

const { nowMs } = platform;
const { GOAL_ENTRY_TYPE, GOAL_CONTINUE_MESSAGE_TYPE, findActiveGoalCondition } = goalModule;
const { isContextOverflow } = compat;

export default class SessionGoal {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  goalInternal!: goalTypes.GoalLoop;

  setGoal(condition: string): void {
    this.goalInternal.set(condition);
  }

  clearGoal(): boolean {
    return this.goalInternal.clear();
  }

  get goal(): goalTypes.GoalSnapshot | undefined {
    return this.goalInternal.snapshot;
  }

  private recordGoalEntry(data: goalTypes.GoalEntryData): void {
    const entry = this.session.sessionManager.getEntry(
      this.session.sessionManager.appendCustomEntry(GOAL_ENTRY_TYPE, data),
    );
    if (entry !== undefined) this.session.emit({ entry, type: "entry_appended" });
  }

  createGoalLoop(): goalTypes.GoalLoop {
    return new GoalLoop(
      {
        changed: () =>
          this.session.emit({ goal: this.goalInternal.snapshot, type: "goal_changed" }),
        evaluate: (prompt, signal) =>
          Effect.runPromise(this.session.integrations.goalEvaluation.evaluateGoal(prompt, signal)),
        isContextOverflow: (message) =>
          isContextOverflow(
            message,
            (this.session.models.selection.modelForMessage(message) ?? this.session.model)
              ?.contextWindow ?? 0,
          ),
        lastAssistant: () => this.session.context.transcript.findLastAssistantMessage(),
        messages: () => this.session.messages,
        queueContinue: (text) =>
          this.session.agent.followUp({
            content: text,
            customType: GOAL_CONTINUE_MESSAGE_TYPE,
            display: false,
            role: "custom",
            timestamp: nowMs(),
          }),
        record: (data) => this.recordGoalEntry(data),
        totalTokens: () => this.session.context.stats.totalSessionTokens(),
      },
      findActiveGoalCondition(this.session.sessionManager.getBranch()),
    );
  }

  start(): void {
    this.goalInternal = this.createGoalLoop();
  }
}
