import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type GoalLoopClass from "./goal-loop.ts";

declare namespace goalTypes {
  type GoalCommand = { kind: "status" } | { kind: "clear" } | { kind: "set"; condition: string };

  type GoalVerdict = "not_met" | "met" | "impossible";

  interface GoalEvaluation {
    verdict: GoalVerdict;
    reason: string;
  }

  type GoalEntryData =
    | { event: "set"; condition: string }
    | { event: "evaluated"; condition: string; reason: string; turn: number }
    | {
        event: "met" | "impossible";
        condition: string;
        reason: string;
        turns: number;
        elapsedMs: number;
        tokens: number;
      }
    | { event: "cleared"; condition: string }
    | { event: "failed"; condition: string; reason: string }
    | { event: "paused"; condition: string; reason: string }
    | { event: "waiting"; condition: string; reason: string; delayMs: number };

  type GoalErrorKind = "fatal" | "rate_limit" | "transient";

  type GoalTone = "accent" | "muted" | "success" | "error" | "warning";

  interface GoalSnapshot {
    condition: string;
    startedAt: number;
    turns: number;
    tokens: number;
    lastEvaluation?: GoalEvaluation;
    evaluating: boolean;
  }

  interface GoalHost {
    messages(): agentTypes.AgentMessage[];
    totalTokens(): number;
    lastAssistant(): compatTypes.AssistantMessage | undefined;
    isContextOverflow(message: compatTypes.AssistantMessage): boolean;
    evaluate(prompt: string, signal: AbortSignal): Promise<string>;
    record(data: GoalEntryData): void;
    queueContinue(text: string): void;
    changed(): void;
  }

  type GoalLoop = (typeof GoalLoopClass)["prototype"];
}

export type { goalTypes as default };
