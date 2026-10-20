import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import { toErrorMessage } from "../utils/errors.ts";
import { awaited, awaitingWith, performed } from "./awaiting.ts";
import { serializeConversation } from "./compaction/utils.ts";
import { convertToLlm } from "./messages.ts";
import { nowMs, sleepFor } from "./platform.ts";
import type { SessionEntry } from "./session-manager.ts";

export const GOAL_ENTRY_TYPE = "msa.goal";
export const GOAL_CONTINUE_MESSAGE_TYPE = "msa.goal.continue";
export const MAX_GOAL_CONDITION_LENGTH = 4000;
export const GOAL_NO_PROGRESS_TURN_LIMIT = 3;
export const GOAL_ERROR_TURN_LIMIT = 3;
const RATE_LIMIT_BASE_DELAY_MS = 60_000;
const RATE_LIMIT_MAX_DELAY_MS = 15 * 60_000;
const MAX_TRANSCRIPT_CHARS = 120_000;
const TOOL_RESULT_HEAD_CHARS = 500;
const TOOL_RESULT_TAIL_CHARS = 1500;

const CLEAR_WORDS = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

export type GoalCommand =
  | { kind: "status" }
  | { kind: "clear" }
  | { kind: "set"; condition: string };

export function parseGoalCommand(text: string): GoalCommand | undefined {
  const match = /^\/goal(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (match === null) return undefined;
  const args = (match[1] ?? "").trim();
  if (args === "") return { kind: "status" };
  if (CLEAR_WORDS.has(args.toLowerCase())) return { kind: "clear" };
  return { condition: args, kind: "set" };
}

export type GoalVerdict = "not_met" | "met" | "impossible";

export interface GoalEvaluation {
  verdict: GoalVerdict;
  reason: string;
}

export type GoalEntryData =
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

const ENDING_EVENTS: ReadonlySet<GoalEntryData["event"]> = new Set([
  "met",
  "impossible",
  "cleared",
  "failed",
]);

export function isGoalEntryData(value: unknown): value is GoalEntryData {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    typeof value.event === "string" &&
    "condition" in value &&
    typeof value.condition === "string"
  );
}

export function findActiveGoalCondition(branch: readonly SessionEntry[]): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]!;
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
    if (!isGoalEntryData(entry.data)) continue;
    if (entry.data.event === "set") return entry.data.condition;
    if (ENDING_EVENTS.has(entry.data.event)) return undefined;
  }
  return undefined;
}

export type GoalErrorKind = "fatal" | "rate_limit" | "transient";

const FATAL_ERROR_PATTERN = new RegExp(
  [
    "\\b401\\b",
    "\\b403\\b",
    "unauthori[sz]ed",
    "authenticat",
    "invalid.?api.?key",
    "invalid x-api-key",
    "permission.?denied",
    "forbidden",
    "credit",
    "insufficient_quota",
    "quota exceeded",
    "out of budget",
    "billing",
    "usage.?limit",
    "available balance",
    "\\b404\\b",
    "not_found_error",
    "model.{0,40}(?:not found|does not exist|not available|not supported|unavailable)",
    "(?:unknown|unsupported|no such) model",
  ].join("|"),
  "iu",
);
const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|\b429\b|ResourceExhausted/iu;

export function classifyGoalError(
  message: compatTypes.AssistantMessage,
  contextOverflow: boolean,
): GoalErrorKind {
  if (contextOverflow) return "fatal";
  const text = message.errorMessage ?? "";
  if (FATAL_ERROR_PATTERN.test(text)) return "fatal";
  if (RATE_LIMIT_PATTERN.test(text)) return "rate_limit";
  return "transient";
}

const SMALL_TIER_PATTERN = /(?:^|[-_./:])(?:haiku|flash|mini|lite|small)(?=$|[-_./:])/iu;

function price(model: compatTypes.Model<compatTypes.Api>): number {
  return model.cost.input + model.cost.output;
}

export function pickEvaluatorModel(
  current: compatTypes.Model<compatTypes.Api>,
  available: readonly compatTypes.Model<compatTypes.Api>[],
): compatTypes.Model<compatTypes.Api> {
  let best: compatTypes.Model<compatTypes.Api> | undefined;
  for (const model of available) {
    if (model.provider !== current.provider || !SMALL_TIER_PATTERN.test(model.id)) continue;
    if (price(model) > price(current)) continue;
    if (best === undefined || price(model) > price(best)) best = model;
  }
  return best ?? current;
}

export const GOAL_EVALUATOR_SYSTEM_PROMPT = `You judge whether an autonomous coding agent has met a completion condition set by its user.

You only see the transcript. Judge from evidence in it, such as tool output and test results, not from the agent's claims alone. You cannot run tools.

Respond with only a JSON object: {"verdict": "not_met" | "met" | "impossible", "reason": "<one or two sentences>"}
- met: the transcript shows the condition holds. If the condition includes a stop clause such as a turn or time limit and that limit has been reached, it is met; say so in the reason.
- impossible: the condition cannot be met in this session, for example it contradicts itself, needs access or a decision only the user has, or the agent is repeatedly blocked by the same obstacle.
- not_met: otherwise. The reason is guidance for the agent's next turn: say what is still missing.`;

function truncateToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS) return text;
  const omitted = text.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS;
  return `${text.slice(0, TOOL_RESULT_HEAD_CHARS)}\n[... ${omitted} characters omitted ...]\n${text.slice(-TOOL_RESULT_TAIL_CHARS)}`;
}

export function buildGoalEvaluationPrompt(input: {
  condition: string;
  messages: agentTypes.AgentMessage[];
  turn: number;
  elapsedMs: number;
}): string {
  let transcript = serializeConversation(convertToLlm(input.messages), truncateToolResult);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = `[... earlier transcript omitted ...]\n\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`;
  }
  return [
    `<condition>\n${input.condition}\n</condition>`,
    `This is evaluation ${input.turn} of the goal. Elapsed since the goal was set: ${formatGoalDuration(input.elapsedMs)}.`,
    `<transcript>\n${transcript}\n</transcript>`,
    "Has the condition been met? Answer with the JSON object only.",
  ].join("\n\n");
}

const VERDICTS: ReadonlySet<string> = new Set<GoalVerdict>(["not_met", "met", "impossible"]);

export function parseGoalEvaluation(text: string): GoalEvaluation | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const verdict = "verdict" in value ? value.verdict : undefined;
  const reason = "reason" in value ? value.reason : undefined;
  if (typeof verdict !== "string" || !VERDICTS.has(verdict)) return undefined;
  return {
    reason:
      typeof reason === "string" && reason.trim() !== "" ? reason.trim() : "(no reason given)",
    verdict: verdict as GoalVerdict,
  };
}

export function formatGoalDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function firstLine(text: string, max = 120): string {
  const line = text.split("\n", 1)[0]!.trim();
  return line.length > max || text.includes("\n") ? `${line.slice(0, max)}…` : line;
}

function turnCount(turns: number): string {
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

export type GoalTone = "accent" | "muted" | "success" | "error" | "warning";

export function describeGoalEntry(
  entry: SessionEntry,
): { tone: GoalTone; text: string } | undefined {
  if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) return undefined;
  if (!isGoalEntryData(entry.data)) return undefined;
  const data = entry.data;
  switch (data.event) {
    case "set":
      return { text: `◎ Goal set: ${firstLine(data.condition)}`, tone: "accent" };
    case "evaluated":
      return { text: `◎ Not met yet (turn ${data.turn}): ${data.reason}`, tone: "muted" };
    case "met":
      return {
        text: `✓ Goal met · ${turnCount(data.turns)} · ${formatGoalDuration(data.elapsedMs)} · ${formatTokenCount(data.tokens)} tokens: ${data.reason}`,
        tone: "success",
      };
    case "impossible":
      return { text: `✗ Goal cannot be met: ${data.reason}`, tone: "error" };
    case "cleared":
      return { text: `◎ Goal cleared: ${firstLine(data.condition)}`, tone: "muted" };
    case "failed":
      return { text: `✗ Goal stopped by an error: ${data.reason}`, tone: "error" };
    case "paused":
      return { text: `◎ Goal paused: ${data.reason}`, tone: "warning" };
    case "waiting":
      return {
        text: `◎ Rate limited, resuming in ${formatGoalDuration(data.delayMs)}: ${data.reason}`,
        tone: "warning",
      };
  }
}

export function describeGoalStatus(goal: GoalSnapshot | undefined, now: number): string[] {
  if (goal === undefined) return ["No active goal"];
  const lines = [
    "◎ /goal active",
    goal.condition,
    "",
    `${formatGoalDuration(now - goal.startedAt)} · ${turnCount(goal.turns)} evaluated · ${formatTokenCount(goal.tokens)} tokens`,
  ];
  if (goal.evaluating) lines.push("Evaluating…");
  if (goal.lastEvaluation !== undefined) lines.push(`Last verdict: ${goal.lastEvaluation.reason}`);
  return lines;
}

export function describeGoalIndicator(goal: GoalSnapshot, now: number): string {
  const parts = ["◎ /goal active", formatGoalDuration(now - goal.startedAt)];
  if (goal.turns > 0) parts.push(turnCount(goal.turns));
  if (goal.evaluating) parts.push("evaluating…");
  return parts.join(" · ");
}

export interface GoalSnapshot {
  condition: string;
  startedAt: number;
  turns: number;
  tokens: number;
  lastEvaluation?: GoalEvaluation;
  evaluating: boolean;
}

export interface GoalHost {
  messages(): agentTypes.AgentMessage[];
  totalTokens(): number;
  lastAssistant(): compatTypes.AssistantMessage | undefined;
  isContextOverflow(message: compatTypes.AssistantMessage): boolean;
  evaluate(prompt: string, signal: AbortSignal): Promise<string>;
  record(data: GoalEntryData): void;
  queueContinue(text: string): void;
  changed(): void;
}

interface ActiveGoal {
  condition: string;
  startedAt: number;
  tokenBaseline: number;
  turns: number;
  lastEvaluation?: GoalEvaluation;
  evaluating: boolean;
  toolUsed: boolean;
  idleTurns: number;
  errorTurns: number;
  rateLimitWaits: number;
}

export class GoalLoop {
  private active: ActiveGoal | undefined;
  private abortController: AbortController | undefined;
  private readonly host: GoalHost;

  constructor(host: GoalHost, restoredCondition?: string) {
    this.host = host;
    if (restoredCondition !== undefined && restoredCondition !== "")
      this.active = this.start(restoredCondition);
  }

  get snapshot(): GoalSnapshot | undefined {
    const goal = this.active;
    if (goal === undefined) return undefined;
    return {
      condition: goal.condition,
      startedAt: goal.startedAt,
      turns: goal.turns,
      tokens: Math.max(0, this.host.totalTokens() - goal.tokenBaseline),
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

  private end(data: GoalEntryData): void {
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
        let evaluation: GoalEvaluation | undefined;
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
