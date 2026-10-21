import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import compaction from "./compaction/compaction.ts";
import utils from "./compaction/utils.ts";
import messagesModule from "./messages.ts";
import platform from "./platform/index.ts";

const { contentText, normalizeContext } = ai;
const { getSummarizationFailure, completeSummarization, estimateTokens } = compaction;
const { nowMs } = platform;
const { awaited, awaiting } = awaitingModule;
const { convertToLlm } = messagesModule;
const { serializeConversation } = utils;

const BUG_SUMMARY_SYSTEM_PROMPT = `You are helping a user file a bug report about msa, the coding agent they are talking to. You will be shown the conversation transcript. Write a report for the msa developers describing what the user was doing and what went wrong.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the report.`;

const BUG_SUMMARY_INSTRUCTIONS = `Write the bug report in Markdown with these sections:

## What the user was doing
One short paragraph.

## What went wrong
Concrete description of the failure: wrong output, errors, hangs, tool failures, unexpected behavior. Quote error messages and tool output verbatim where they exist.

## Steps to reproduce
Numbered list, as specific as the transcript allows.

## Relevant details
Tool calls involved, files touched, model behavior, anything else that helps a developer reproduce or locate the problem.

Do not include file contents, secrets, or credentials from the transcript; refer to files by path only. Keep the report factual and concise.`;

function selectMessages(
  messages: readonly agentTypes.AgentMessage[],
  tokenBudget: number,
): agentTypes.AgentMessage[] {
  const selected: agentTypes.AgentMessage[] = [];
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message === undefined) continue;
    const next = estimateTokens(message);
    if (selected.length > 0 && tokens + next > tokenBudget) break;
    selected.push(message);
    tokens += next;
  }
  return selected.reverse();
}

function buildSummaryPrompt(
  options: bugReportInternalTypes.GenerateBugReportSummaryOptions,
  contextWindow: number,
) {
  const messages = selectMessages(options.messages, Math.floor(contextWindow * 0.6));
  const hint = options.hint?.trim();
  const prompt = [
    messages.length < options.messages.length
      ? `Note: only the last ${messages.length} of ${options.messages.length} messages are shown.`
      : undefined,
    `<conversation>\n${serializeConversation(convertToLlm(messages))}\n</conversation>`,
    hint !== undefined && hint !== "" ? `<user-report>\n${hint}\n</user-report>` : undefined,
    BUG_SUMMARY_INSTRUCTIONS,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
  return prompt;
}

function generateBugReportSummary(
  options: bugReportInternalTypes.GenerateBugReportSummaryOptions,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const { model } = options;
      const contextWindow = model.contextWindow > 0 ? model.contextWindow : 128_000;
      const prompt = buildSummaryPrompt(options, contextWindow);
      const requestOptions: compatTypes.SimpleStreamOptions = {
        apiKey: options.apiKey,
        env: options.env,
        headers: options.headers,
        maxTokens: Math.min(4096, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY),
        sessionId: options.sessionId,
        signal: options.signal,
        ...(model.reasoning &&
        options.thinkingLevel !== undefined &&
        options.thinkingLevel !== "off"
          ? { reasoning: options.thinkingLevel }
          : {}),
      };
      const response = yield* awaited(
        completeSummarization(
          model,
          normalizeContext({
            messages: [
              { content: [{ text: prompt, type: "text" }], role: "user", timestamp: nowMs() },
            ],
            systemPrompt: BUG_SUMMARY_SYSTEM_PROMPT,
          }),
          requestOptions,
          options.streamFn,
          options.retry,
        ),
      );
      if (response.stopReason === "aborted") throw new Error("Bug report summary was cancelled");
      const failure = getSummarizationFailure(response, "Bug report summary");
      if (failure !== undefined && failure !== "") throw new Error(failure);
      if (response.content.some((block) => block.type === "toolCall")) {
        throw new Error("Bug report summary attempted to call a tool");
      }
      const text = contentText(response.content, "\n").trim();
      if (text === "") throw new Error("Bug report summary was empty");
      return text;
    }),
  );
}

const bugReportSummary = { generateBugReportSummary };

export default bugReportSummary;
