import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import utils from "./compaction/utils.ts";
import type goalTypes from "./goal.types.ts";
import messagesModule from "./messages.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { serializeConversation } = utils;
const { convertToLlm } = messagesModule;
const GOAL_ENTRY_TYPE = "msa.goal";
const GOAL_CONTINUE_MESSAGE_TYPE = "msa.goal.continue";
const MAX_GOAL_CONDITION_LENGTH = 4000;
const GOAL_NO_PROGRESS_TURN_LIMIT = 3;
const GOAL_ERROR_TURN_LIMIT = 3;
const MAX_TRANSCRIPT_CHARS = 120_000;
const TOOL_RESULT_HEAD_CHARS = 500;
const TOOL_RESULT_TAIL_CHARS = 1500;
const CLEAR_WORDS = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);
function parseGoalCommand(text: string): goalTypes.GoalCommand | undefined {
  const match = /^\/goal(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (match === null) return undefined;
  const args = (match[1] ?? "").trim();
  if (args === "") return { kind: "status" };
  if (CLEAR_WORDS.has(args.toLowerCase())) return { kind: "clear" };
  return { condition: args, kind: "set" };
}
const ENDING_EVENTS: ReadonlySet<goalTypes.GoalEntryData["event"]> = new Set([
  "met",
  "impossible",
  "cleared",
  "failed",
]);
function isGoalEntryData(value: unknown): value is goalTypes.GoalEntryData {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    typeof value.event === "string" &&
    "condition" in value &&
    typeof value.condition === "string"
  );
}
function findActiveGoalCondition(
  branch: readonly sessionManagerTypes.SessionEntry[],
): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]!;
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
    if (!isGoalEntryData(entry.data)) continue;
    if (entry.data.event === "set") return entry.data.condition;
    if (ENDING_EVENTS.has(entry.data.event)) return undefined;
  }
  return undefined;
}
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
function classifyGoalError(
  message: compatTypes.AssistantMessage,
  contextOverflow: boolean,
): goalTypes.GoalErrorKind {
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
function pickEvaluatorModel(
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
const GOAL_EVALUATOR_SYSTEM_PROMPT = `You judge whether an autonomous coding agent has met a completion condition set by its user.

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
function buildGoalEvaluationPrompt(input: {
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
const VERDICTS: ReadonlySet<string> = new Set<goalTypes.GoalVerdict>([
  "not_met",
  "met",
  "impossible",
]);
function parseGoalEvaluation(text: string): goalTypes.GoalEvaluation | undefined {
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
    verdict: verdict as goalTypes.GoalVerdict,
  };
}
function formatGoalDuration(ms: number): string {
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
function describeGoalEntry(
  entry: sessionManagerTypes.SessionEntry,
): { tone: goalTypes.GoalTone; text: string } | undefined {
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
function describeGoalStatus(goal: goalTypes.GoalSnapshot | undefined, now: number): string[] {
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
function describeGoalIndicator(goal: goalTypes.GoalSnapshot, now: number): string {
  const parts = ["◎ /goal active", formatGoalDuration(now - goal.startedAt)];
  if (goal.turns > 0) parts.push(turnCount(goal.turns));
  if (goal.evaluating) parts.push("evaluating…");
  return parts.join(" · ");
}

const goal = {
  GOAL_CONTINUE_MESSAGE_TYPE,
  GOAL_ENTRY_TYPE,
  GOAL_ERROR_TURN_LIMIT,
  GOAL_EVALUATOR_SYSTEM_PROMPT,
  GOAL_NO_PROGRESS_TURN_LIMIT,
  MAX_GOAL_CONDITION_LENGTH,
  buildGoalEvaluationPrompt,
  classifyGoalError,
  describeGoalEntry,
  describeGoalIndicator,
  describeGoalStatus,
  findActiveGoalCondition,
  formatGoalDuration,
  isGoalEntryData,
  parseGoalCommand,
  parseGoalEvaluation,
  pickEvaluatorModel,
};

export default goal;
