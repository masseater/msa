import type { ExtensionAPI, Theme } from "@msa/coding-agent";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import type { Question, QuestionnaireResult } from "./questionnaire-types.ts";
import { askQuestionnaire } from "./questionnaire-ui.ts";

const { Text } = tuiModule;

const QuestionOptionSchema = Type.Object({
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
  label: Type.String({ description: "Display label for the option" }),
  value: Type.String({ description: "The value returned when selected" }),
});

const QuestionSchema = Type.Object({
  allowOther: Type.Optional(
    Type.Boolean({ description: "Allow 'Type something' option (default: true)" }),
  ),
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
    }),
  ),
  options: Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }),
  prompt: Type.String({ description: "The full question text to display" }),
});

const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, { description: "Questions to ask the user" }),
});

interface QuestionnaireParamsValue {
  questions: Array<{
    id: string;
    label?: string | undefined;
    prompt: string;
    options: Array<{ value: string; label: string; description?: string | undefined }>;
    allowOther?: boolean | undefined;
  }>;
}

const errorResult = (message: string, questions: Question[] = []) => ({
  content: [{ text: message, type: "text" as const }],
  details: { answers: [], cancelled: true, questions } satisfies QuestionnaireResult,
});

const answerLines = (result: QuestionnaireResult): string[] =>
  result.answers.map((answer) => {
    const label = result.questions.find((q) => q.id === answer.id)?.label || answer.id;
    return answer.wasCustom
      ? `${label}: user wrote: ${answer.label}`
      : `${label}: user selected: ${answer.index}. ${answer.label}`;
  });

const resultFor = (result: QuestionnaireResult) => {
  if (result.cancelled) {
    return {
      content: [{ text: "User cancelled the questionnaire", type: "text" as const }],
      details: result,
    };
  }
  return {
    content: [{ text: answerLines(result).join("\n"), type: "text" as const }],
    details: result,
  };
};

const toQuestions = (params: QuestionnaireParamsValue): Question[] =>
  params.questions.map((question, i) => ({
    ...question,
    allowOther: question.allowOther !== false,
    label: question.label || `Q${i + 1}`,
  }));

const runQuestionnaire = (
  ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  params: QuestionnaireParamsValue,
) =>
  Effect.gen(function* () {
    if (ctx.mode !== "tui") {
      return errorResult("Error: UI not available (running in non-interactive mode)");
    }
    if (params.questions.length === 0) {
      return errorResult("Error: No questions provided");
    }

    const questions = toQuestions(params);
    const result = yield* Effect.promise(() =>
      ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) =>
        askQuestionnaire({ done, questions, theme, tui }),
      ),
    );
    return resultFor(result);
  });

const renderCall = (args: QuestionnaireParamsValue, theme: Theme): tuiTypes.Text => {
  const questions = args.questions;
  const count = questions.length;
  const labels = questions.map((q) => q.label || q.id).join(", ");
  let text = theme.fg("toolTitle", theme.bold("questionnaire "));
  text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
  if (labels.length > 0) {
    text += theme.fg("dim", ` (${labels})`);
  }
  return new Text(text, 0, 0);
};

const renderResult = (
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown },
  _options: unknown,
  theme: Theme,
): tuiTypes.Text => {
  const details = result.details as QuestionnaireResult | undefined;
  if (details === undefined) {
    const content = result.content[0];
    return new Text(content?.type === "text" ? (content.text ?? "") : "", 0, 0);
  }
  if (details.cancelled) {
    return new Text(theme.fg("warning", "Cancelled"), 0, 0);
  }

  const lines = details.answers.map((answer) => {
    if (answer.wasCustom) {
      return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
    }
    const display = answer.index === undefined ? answer.label : `${answer.index}. ${answer.label}`;
    return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
  });
  return new Text(lines.join("\n"), 0, 0);
};

export default function questionnaire(msa: ExtensionAPI) {
  msa.registerTool({
    description:
      "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(runQuestionnaire(ctx, params)),
    label: "Questionnaire",
    name: "questionnaire",
    parameters: QuestionnaireParams,
    renderCall,
    renderResult,
  });
}
