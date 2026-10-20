import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import errors from "../utils/errors.ts";
import awaitingModule from "./awaiting.ts";
import goalModule from "./goal.ts";
import type goalTypes from "./goal.types.ts";
import platform from "./platform.ts";
const { awaited, awaitingWith, performed } = awaitingModule;
const { nowMs, sleepFor } = platform;
const { toErrorMessage } = errors;
const {
  GOAL_ERROR_TURN_LIMIT,
  GOAL_NO_PROGRESS_TURN_LIMIT,
  MAX_GOAL_CONDITION_LENGTH,
  buildGoalEvaluationPrompt,
  classifyGoalError,
  parseGoalEvaluation,
} = goalModule;

const RATE_LIMIT_BASE_DELAY_MS = 60_000;
const RATE_LIMIT_MAX_DELAY_MS = 15 * 60_000;
interface ActiveGoal {
  condition: string;
  startedAt: number;
  tokenBaseline: number;
  turns: number;
  lastEvaluation?: goalTypes.GoalEvaluation;
  evaluating: boolean;
  toolUsed: boolean;
  idleTurns: number;
  errorTurns: number;
  rateLimitWaits: number;
}
export default class GoalLoop {
  private active: ActiveGoal | undefined;
  private abortController: AbortController | undefined;
  private readonly host: goalTypes.GoalHost;

  constructor(host: goalTypes.GoalHost, restoredCondition?: string) {
    this.host = host;
    if (restoredCondition !== undefined && restoredCondition !== "")
      this.active = this.start(restoredCondition);
  }

  get snapshot(): goalTypes.GoalSnapshot | undefined {
    const goal = this.active;
    if (goal === undefined) return undefined;
    return {
      condition: goal.condition,
      startedAt: goal.startedAt,
      tokens: Math.max(0, this.host.totalTokens() - goal.tokenBaseline),
      turns: goal.turns,
      ...(goal.lastEvaluation === undefined ? {} : { lastEvaluation: goal.lastEvaluation }),
      evaluating: goal.evaluating,
    };
  }

  set(condition: string): void {
    const trimmed = condition.trim();
    if (trimmed === "") throw new Error("Goal condition is empty");
    if (trimmed.length > MAX_GOAL_CONDITION_LENGTH) {
      throw new Error(
        `Goal condition is ${trimmed.length} characters; the limit is ${MAX_GOAL_CONDITION_LENGTH}`,
      );
    }
    this.abortController?.abort();
    this.active = this.start(trimmed);
    this.host.record({ condition: trimmed, event: "set" });
    this.host.changed();
  }

  clear(): boolean {
    const goal = this.active;
    if (goal === undefined) return false;
    this.end({ condition: goal.condition, event: "cleared" });
    return true;
  }

  noteToolUse(): void {
    if (this.active !== undefined) this.active.toolUsed = true;
  }

  resetGuards(): void {
    if (this.active === undefined) return;
    this.active.idleTurns = 0;
    this.active.errorTurns = 0;
    this.active.rateLimitWaits = 0;
  }

  abort(): void {
    this.abortController?.abort();
  }

  afterRun(): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const goal = this.active;
        if (goal === undefined) return false;
        const last = this.host.lastAssistant();
        if (last?.stopReason === "aborted") return false;
        const controller = new AbortController();
        this.abortController = controller;
        try {
          if (last?.stopReason === "error")
            return yield* performed(this.afterError(goal, last, controller.signal));
          goal.errorTurns = 0;
          goal.rateLimitWaits = 0;
          return yield* awaited(this.evaluate(goal, controller.signal));
        } finally {
          if (this.abortController === controller) this.abortController = undefined;
        }
      }, this),
    );
  }

  private start(condition: string): ActiveGoal {
    return {
      condition,
      errorTurns: 0,
      evaluating: false,
      idleTurns: 0,
      rateLimitWaits: 0,
      startedAt: nowMs(),
      tokenBaseline: this.host.totalTokens(),
      toolUsed: false,
      turns: 0,
    };
  }

  private end(data: goalTypes.GoalEntryData): void {
    this.abortController?.abort();
    this.active = undefined;
    this.host.record(data);
    this.host.changed();
  }

  private pause(goal: ActiveGoal, reason: string): false {
    this.host.record({ condition: goal.condition, event: "paused", reason });
    this.host.changed();
    return false;
  }

  private afterError(
    goal: ActiveGoal,
    message: compatTypes.AssistantMessage,
    signal: AbortSignal,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const error = message.errorMessage || "Unknown error";
      const kind = classifyGoalError(message, this.host.isContextOverflow(message));
      if (kind === "fatal") {
        this.end({ condition: goal.condition, event: "failed", reason: error });
        return false;
      }
      if (kind === "rate_limit") {
        goal.rateLimitWaits++;
        const delayMs = Math.min(
          RATE_LIMIT_BASE_DELAY_MS * 2 ** (goal.rateLimitWaits - 1),
          RATE_LIMIT_MAX_DELAY_MS,
        );
        this.host.record({ condition: goal.condition, delayMs, event: "waiting", reason: error });
        try {
          yield* performed(sleepFor(delayMs, signal));
        } catch {
          return false;
        }
        if (this.active !== goal) return false;
      } else {
        goal.errorTurns++;
        if (goal.errorTurns >= GOAL_ERROR_TURN_LIMIT) {
          return this.pause(goal, `${goal.errorTurns} turns in a row failed: ${error}`);
        }
      }
      this.host.queueContinue(
        `The previous attempt ended with an error: ${error}\n\nContinue working toward the goal:\n${goal.condition}`,
      );
      return true;
    }, this);
  }

  private evaluate(goal: ActiveGoal, signal: AbortSignal): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const toolUsed = goal.toolUsed;
        goal.toolUsed = false;
        const turn = goal.turns + 1;
        const prompt = buildGoalEvaluationPrompt({
          condition: goal.condition,
          elapsedMs: nowMs() - goal.startedAt,
          messages: this.host.messages(),
          turn,
        });
        goal.evaluating = true;
        this.host.changed();
        let evaluation: goalTypes.GoalEvaluation | undefined;
        try {
          const text = yield* awaited(this.host.evaluate(prompt, signal));
          evaluation = parseGoalEvaluation(text);
          if (evaluation === undefined)
            throw new Error(`Evaluator returned no verdict: ${text.slice(0, 200)}`);
        } catch (error) {
          goal.evaluating = false;
          if (signal.aborted || this.active !== goal) {
            this.host.changed();
            return false;
          }
          const reason = toErrorMessage(error);
          return this.pause(goal, `Goal evaluation failed: ${reason}`);
        }
        goal.evaluating = false;
        if (signal.aborted || this.active !== goal) {
          this.host.changed();
          return false;
        }
        goal.turns = turn;
        goal.lastEvaluation = evaluation;

        if (evaluation.verdict !== "not_met") {
          this.end({
            condition: goal.condition,
            elapsedMs: nowMs() - goal.startedAt,
            event: evaluation.verdict,
            reason: evaluation.reason,
            tokens: Math.max(0, this.host.totalTokens() - goal.tokenBaseline),
            turns: goal.turns,
          });
          return false;
        }

        this.host.record({
          condition: goal.condition,
          event: "evaluated",
          reason: evaluation.reason,
          turn,
        });
        goal.idleTurns = toolUsed ? 0 : goal.idleTurns + 1;
        if (goal.idleTurns >= GOAL_NO_PROGRESS_TURN_LIMIT) {
          goal.idleTurns = 0;
          return this.pause(goal, `No tool calls in ${GOAL_NO_PROGRESS_TURN_LIMIT} turns in a row`);
        }
        this.host.changed();
        this.host.queueContinue(
          `The goal is not met yet: ${evaluation.reason}\n\nKeep working until this condition holds:\n${goal.condition}`,
        );
        return true;
      }, this),
    );
  }
}
