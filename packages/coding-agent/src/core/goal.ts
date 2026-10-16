/**
 * `/goal`: keep a session running across turns until a completion condition holds.
 *
 * After every run that would otherwise settle, a separate evaluator model reads the transcript
 * and answers not_met / met / impossible. not_met continues the run with the evaluator's reason
 * as guidance; met and impossible end the goal. The goal lives in session entries so a resumed
 * session restores an unfinished one.
 */

import type { AgentMessage } from "@msa/agent-core";
import type { Api, AssistantMessage, Model } from "@msa/ai/compat";

import { sleep } from "../utils/sleep.ts";
import { serializeConversation } from "./compaction/utils.ts";
import { convertToLlm } from "./messages.ts";
import type { SessionEntry } from "./session-manager.ts";

export const GOAL_ENTRY_TYPE = "msa.goal";
export const GOAL_CONTINUE_MESSAGE_TYPE = "msa.goal.continue";
export const MAX_GOAL_CONDITION_LENGTH = 4000;
/** Consecutive evaluated turns without a tool call before the loop hands control back. */
export const GOAL_NO_PROGRESS_TURN_LIMIT = 3;
/** Consecutive failed turns (after the session's own retries) before the loop pauses. */
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

/** Parse `/goal [condition|clear]`, or return undefined when `text` is not a `/goal` command. */
export function parseGoalCommand(text: string): GoalCommand | undefined {
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return undefined;
  const args = (match[1] ?? "").trim();
  if (!args) return { kind: "status" };
  if (CLEAR_WORDS.has(args.toLowerCase())) return { kind: "clear" };
  return { kind: "set", condition: args };
}

export type GoalVerdict = "not_met" | "met" | "impossible";

export interface GoalEvaluation {
  verdict: GoalVerdict;
  reason: string;
}

/** Data of a `msa.goal` custom entry. */
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

/** The condition of the goal that was still active at the end of `branch`. */
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
    // Authentication
    "\\b401\\b",
    "\\b403\\b",
    "unauthori[sz]ed",
    "authenticat",
    "invalid.?api.?key",
    "invalid x-api-key",
    "permission.?denied",
    "forbidden",
    // Credits and quota
    "credit",
    "insufficient_quota",
    "quota exceeded",
    "out of budget",
    "billing",
    "usage.?limit",
    "available balance",
    // Model availability
    "\\b404\\b",
    "not_found_error",
    "model.{0,40}(?:not found|does not exist|not available|not supported|unavailable)",
    "(?:unknown|unsupported|no such) model",
  ].join("|"),
  "i",
);
const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|\b429\b|ResourceExhausted/i;

/**
 * How a goal reacts to a run that ended in an error the session could not recover from itself.
 * Context overflow reaches here only after compaction failed to resolve it.
 */
export function classifyGoalError(
  message: AssistantMessage,
  contextOverflow: boolean,
): GoalErrorKind {
  if (contextOverflow) return "fatal";
  const text = message.errorMessage ?? "";
  if (FATAL_ERROR_PATTERN.test(text)) return "fatal";
  if (RATE_LIMIT_PATTERN.test(text)) return "rate_limit";
  return "transient";
}

const SMALL_TIER_PATTERN = /(?:^|[-_./:])(?:haiku|flash|mini|lite|small)(?=$|[-_./:])/i;

function price(model: Model<Api>): number {
  return model.cost.input + model.cost.output;
}

/**
 * The default evaluator: the strongest small-tier model of the working model's provider that
 * costs no more than the working model, or the working model when its provider has none.
 */
export function pickEvaluatorModel(
  current: Model<Api>,
  available: readonly Model<Api>[],
): Model<Api> {
  let best: Model<Api> | undefined;
  for (const model of available) {
    if (model.provider !== current.provider || !SMALL_TIER_PATTERN.test(model.id)) continue;
    if (price(model) > price(current)) continue;
    if (!best || price(model) > price(best)) best = model;
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
  messages: AgentMessage[];
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
    verdict: verdict as GoalVerdict,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : "(no reason given)",
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

/** The transcript line for a `msa.goal` entry, or undefined for any other entry. */
export function describeGoalEntry(
  entry: SessionEntry,
): { tone: GoalTone; text: string } | undefined {
  if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) return undefined;
  if (!isGoalEntryData(entry.data)) return undefined;
  const data = entry.data;
  switch (data.event) {
    case "set":
      return { tone: "accent", text: `◎ Goal set: ${firstLine(data.condition)}` };
    case "evaluated":
      return { tone: "muted", text: `◎ Not met yet (turn ${data.turn}): ${data.reason}` };
    case "met":
      return {
        tone: "success",
        text: `✓ Goal met · ${turnCount(data.turns)} · ${formatGoalDuration(data.elapsedMs)} · ${formatTokenCount(data.tokens)} tokens: ${data.reason}`,
      };
    case "impossible":
      return { tone: "error", text: `✗ Goal cannot be met: ${data.reason}` };
    case "cleared":
      return { tone: "muted", text: `◎ Goal cleared: ${firstLine(data.condition)}` };
    case "failed":
      return { tone: "error", text: `✗ Goal stopped by an error: ${data.reason}` };
    case "paused":
      return { tone: "warning", text: `◎ Goal paused: ${data.reason}` };
    case "waiting":
      return {
        tone: "warning",
        text: `◎ Rate limited, resuming in ${formatGoalDuration(data.delayMs)}: ${data.reason}`,
      };
  }
}

/** The answer to `/goal` without arguments, one string per line. */
export function describeGoalStatus(goal: GoalSnapshot | undefined, now: number): string[] {
  if (!goal) return ["No active goal"];
  const lines = [
    "◎ /goal active",
    goal.condition,
    "",
    `${formatGoalDuration(now - goal.startedAt)} · ${turnCount(goal.turns)} evaluated · ${formatTokenCount(goal.tokens)} tokens`,
  ];
  if (goal.evaluating) lines.push("Evaluating…");
  if (goal.lastEvaluation) lines.push(`Last verdict: ${goal.lastEvaluation.reason}`);
  return lines;
}

/** The active goal indicator, such as `◎ /goal active · 3m 2s · 4 turns`. */
export function describeGoalIndicator(goal: GoalSnapshot, now: number): string {
  const parts = ["◎ /goal active", formatGoalDuration(now - goal.startedAt)];
  if (goal.turns > 0) parts.push(turnCount(goal.turns));
  if (goal.evaluating) parts.push("evaluating…");
  return parts.join(" · ");
}

export interface GoalSnapshot {
  condition: string;
  startedAt: number;
  /** Evaluated turns since the goal was set or restored. */
  turns: number;
  /** Tokens the session used since the goal was set or restored, evaluator included. */
  tokens: number;
  lastEvaluation?: GoalEvaluation;
  evaluating: boolean;
}

/** What a goal needs from its session. */
export interface GoalHost {
  messages(): AgentMessage[];
  totalTokens(): number;
  lastAssistant(): AssistantMessage | undefined;
  isContextOverflow(message: AssistantMessage): boolean;
  /** Ask the evaluator model and return its text. */
  evaluate(prompt: string, signal: AbortSignal): Promise<string>;
  record(data: GoalEntryData): void;
  /** Queue a message that the next turn starts from. */
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
    if (restoredCondition) this.active = this.start(restoredCondition);
  }

  get snapshot(): GoalSnapshot | undefined {
    const goal = this.active;
    if (!goal) return undefined;
    return {
      condition: goal.condition,
      startedAt: goal.startedAt,
      turns: goal.turns,
      tokens: Math.max(0, this.host.totalTokens() - goal.tokenBaseline),
      ...(goal.lastEvaluation ? { lastEvaluation: goal.lastEvaluation } : {}),
      evaluating: goal.evaluating,
    };
  }

  /** Set the goal, replacing any active one. */
  set(condition: string): void {
    const trimmed = condition.trim();
    if (!trimmed) throw new Error("Goal condition is empty");
    if (trimmed.length > MAX_GOAL_CONDITION_LENGTH) {
      throw new Error(
        `Goal condition is ${trimmed.length} characters; the limit is ${MAX_GOAL_CONDITION_LENGTH}`,
      );
    }
    this.abortController?.abort();
    this.active = this.start(trimmed);
    this.host.record({ event: "set", condition: trimmed });
    this.host.changed();
  }

  /** Clear the active goal. Returns false when there was none. */
  clear(): boolean {
    const goal = this.active;
    if (!goal) return false;
    this.end({ event: "cleared", condition: goal.condition });
    return true;
  }

  noteToolUse(): void {
    if (this.active) this.active.toolUsed = true;
  }

  /** A run started from outside the loop: the guards that handed control back start over. */
  resetGuards(): void {
    if (!this.active) return;
    this.active.idleTurns = 0;
    this.active.errorTurns = 0;
    this.active.rateLimitWaits = 0;
  }

  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Called when a run would settle. Returns true when a continuation was queued and the run
   * should go on.
   */
  async afterRun(): Promise<boolean> {
    const goal = this.active;
    if (!goal) return false;
    const last = this.host.lastAssistant();
    if (last?.stopReason === "aborted") return false;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      if (last?.stopReason === "error") return await this.afterError(goal, last, controller.signal);
      goal.errorTurns = 0;
      goal.rateLimitWaits = 0;
      return await this.evaluate(goal, controller.signal);
    } finally {
      if (this.abortController === controller) this.abortController = undefined;
    }
  }

  private start(condition: string): ActiveGoal {
    return {
      condition,
      startedAt: Date.now(),
      tokenBaseline: this.host.totalTokens(),
      turns: 0,
      evaluating: false,
      toolUsed: false,
      idleTurns: 0,
      errorTurns: 0,
      rateLimitWaits: 0,
    };
  }

  private end(data: GoalEntryData): void {
    this.abortController?.abort();
    this.active = undefined;
    this.host.record(data);
    this.host.changed();
  }

  private pause(goal: ActiveGoal, reason: string): false {
    this.host.record({ event: "paused", condition: goal.condition, reason });
    this.host.changed();
    return false;
  }

  private async afterError(
    goal: ActiveGoal,
    message: AssistantMessage,
    signal: AbortSignal,
  ): Promise<boolean> {
    const error = message.errorMessage || "Unknown error";
    const kind = classifyGoalError(message, this.host.isContextOverflow(message));
    if (kind === "fatal") {
      this.end({ event: "failed", condition: goal.condition, reason: error });
      return false;
    }
    if (kind === "rate_limit") {
      goal.rateLimitWaits++;
      const delayMs = Math.min(
        RATE_LIMIT_BASE_DELAY_MS * 2 ** (goal.rateLimitWaits - 1),
        RATE_LIMIT_MAX_DELAY_MS,
      );
      this.host.record({ event: "waiting", condition: goal.condition, reason: error, delayMs });
      try {
        await sleep(delayMs, signal);
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
  }

  private async evaluate(goal: ActiveGoal, signal: AbortSignal): Promise<boolean> {
    const toolUsed = goal.toolUsed;
    goal.toolUsed = false;
    const turn = goal.turns + 1;
    const prompt = buildGoalEvaluationPrompt({
      condition: goal.condition,
      messages: this.host.messages(),
      turn,
      elapsedMs: Date.now() - goal.startedAt,
    });
    goal.evaluating = true;
    this.host.changed();
    let evaluation: GoalEvaluation | undefined;
    try {
      const text = await this.host.evaluate(prompt, signal);
      evaluation = parseGoalEvaluation(text);
      if (!evaluation) throw new Error(`Evaluator returned no verdict: ${text.slice(0, 200)}`);
    } catch (error) {
      goal.evaluating = false;
      if (signal.aborted || this.active !== goal) {
        this.host.changed();
        return false;
      }
      const reason = error instanceof Error ? error.message : String(error);
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
        event: evaluation.verdict,
        condition: goal.condition,
        reason: evaluation.reason,
        turns: goal.turns,
        elapsedMs: Date.now() - goal.startedAt,
        tokens: Math.max(0, this.host.totalTokens() - goal.tokenBaseline),
      });
      return false;
    }

    this.host.record({
      event: "evaluated",
      condition: goal.condition,
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
  }
}
