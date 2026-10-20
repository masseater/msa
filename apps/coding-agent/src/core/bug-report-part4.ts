import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportPart2 from "./bug-report-part2.ts";
import bugReportPart3 from "./bug-report-part3.ts";
import compaction from "./compaction/compaction.ts";
import platformModule from "./platform.ts";

const { awaited, awaiting } = awaitingModule;
const { completeSummarization, getSummarizationFailure } = compaction;
const { contentText, normalizeContext } = ai;
const { nowMs } = platformModule;
const { generateBugReportSummaryPart1 } = bugReportPart3;
const { BUG_SUMMARY_SYSTEM_PROMPT } = bugReportPart2;

function generateBugReportSummary(
  options: bugReportInternalTypes.GenerateBugReportSummaryOptions,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const { model } = options;
      const contextWindow = model.contextWindow > 0 ? model.contextWindow : 128_000;
      const prompt = generateBugReportSummaryPart1(options, contextWindow);
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

const bugReportPart4 = {
  generateBugReportSummary,
};

export default bugReportPart4;
