import compat from "@msa/ai/compat";
import * as Effect from "effect/Effect";

import AgentSessionLayer28 from "./agent-session-layer-28.ts";
import GoalLoop from "./goal-loop.ts";
import goalModule from "./goal.ts";
import type goalTypes from "./goal.types.ts";
import platform from "./platform.ts";

const { GOAL_CONTINUE_MESSAGE_TYPE, findActiveGoalCondition } = goalModule;
const { isContextOverflow } = compat;
const { nowMs } = platform;

export default abstract class AgentSessionLayer29 extends AgentSessionLayer28 {
  protected createGoalLoop(): goalTypes.GoalLoop {
    return new GoalLoop(
      {
        changed: () => this.emit({ goal: this.goalInternal.snapshot, type: "goal_changed" }),
        evaluate: (prompt, signal) => Effect.runPromise(this.evaluateGoal(prompt, signal)),
        isContextOverflow: (message) =>
          isContextOverflow(
            message,
            (this.modelForMessage(message) ?? this.model)?.contextWindow ?? 0,
          ),
        lastAssistant: () => this.findLastAssistantMessage(),
        messages: () => this.messages,
        queueContinue: (text) =>
          this.agent.followUp({
            content: text,
            customType: GOAL_CONTINUE_MESSAGE_TYPE,
            display: false,
            role: "custom",
            timestamp: nowMs(),
          }),
        record: (data) => this.recordGoalEntry(data),
        totalTokens: () => this.totalSessionTokens(),
      },
      findActiveGoalCondition(this.sessionManager.getBranch()),
    );
  }
}
