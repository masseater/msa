import type { ExtensionAPI, Theme } from "@msa/coding-agent";
import { Text } from "@msa/tui";
import { Effect } from "effect";
import { Type } from "typebox";

import type { Question, QuestionnaireResult } from "./questionnaire-types.ts";
import { askQuestionnaire } from "./questionnaire-ui.ts";

const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
    }),
  ),
  prompt: Type.String({ description: "The full question text to display" }),
  options: Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }),
  allowOther: Type.Optional(
    Type.Boolean({ description: "Allow 'Type something' option (default: true)" }),
  ),
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
  content: [{ type: "text" as const, text: message }],
  details: { questions, answers: [], cancelled: true } satisfies QuestionnaireResult,
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
      content: [{ type: "text" as const, text: "User cancelled the questionnaire" }],
      details: result,
    };
  }
  return {
    content: [{ type: "text" as const, text: answerLines(result).join("\n") }],
    details: result,
  };
};

const toQuestions = (params: QuestionnaireParamsValue): Question[] =>
  params.questions.map((question, i) => ({
    ...question,
    label: question.label || `Q${i + 1}`,
    allowOther: question.allowOther !== false,
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
        askQuestionnaire({ tui, theme, questions, done }),
      ),
    );
    return resultFor(result);
  });

const renderCall = (args: QuestionnaireParamsValue, theme: Theme): Text => {
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
): Text => {
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
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
    parameters: QuestionnaireParams,

    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(runQuestionnaire(ctx, params)),

    renderCall,
    renderResult,
  });
}
