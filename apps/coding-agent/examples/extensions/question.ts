import type { ExtensionAPI, Theme } from "@msa/coding-agent";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import {
  type DisplayOption,
  type OptionWithDesc,
  type QuestionAnswer,
  askQuestion,
} from "./question-ui.ts";

const { Text } = tuiModule;

interface QuestionDetails {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom?: boolean;
}

const OptionSchema = Type.Object({
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
  label: Type.String({ description: "Display label for the option" }),
});

const QuestionParams = Type.Object({
  options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
  question: Type.String({ description: "The question to ask the user" }),
});

const unavailableResult = (params: { question: string; options: OptionWithDesc[] }) => ({
  content: [
    { text: "Error: UI not available (running in non-interactive mode)", type: "text" as const },
  ],
  details: {
    answer: null,
    options: params.options.map((o) => o.label),
    question: params.question,
  } as QuestionDetails,
});

const noOptionsResult = (params: { question: string }) => ({
  content: [{ text: "Error: No options provided", type: "text" as const }],
  details: { answer: null, options: [], question: params.question } as QuestionDetails,
});

const answerResult = (
  params: { question: string; options: OptionWithDesc[] },
  result: QuestionAnswer | null,
) => {
  const simpleOptions = params.options.map((o) => o.label);

  if (result === null) {
    return {
      content: [{ text: "User cancelled the selection", type: "text" as const }],
      details: {
        answer: null,
        options: simpleOptions,
        question: params.question,
      } as QuestionDetails,
    };
  }

  if (result.wasCustom) {
    return {
      content: [{ text: `User wrote: ${result.answer}`, type: "text" as const }],
      details: {
        answer: result.answer,
        options: simpleOptions,
        question: params.question,
        wasCustom: true,
      } as QuestionDetails,
    };
  }

  return {
    content: [{ text: `User selected: ${result.index}. ${result.answer}`, type: "text" as const }],
    details: {
      answer: result.answer,
      options: simpleOptions,
      question: params.question,
      wasCustom: false,
    } as QuestionDetails,
  };
};

const renderCall = (
  args: { question: string; options?: OptionWithDesc[] },
  theme: Theme,
): tuiTypes.Text => {
  let text = theme.fg("toolTitle", theme.bold("question ")) + theme.fg("muted", args.question);
  const opts = Array.isArray(args.options) ? args.options : [];
  if (opts.length !== 0) {
    const labels = opts.map((o) => o.label);
    const numbered = [...labels, "Type something."].map((o, i) => `${i + 1}. ${o}`);
    text += `\n${theme.fg("dim", `  Options: ${numbered.join(", ")}`)}`;
  }
  return new Text(text, 0, 0);
};

const renderResult = (
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown },
  _options: unknown,
  theme: Theme,
): tuiTypes.Text => {
  const details = result.details as QuestionDetails | undefined;
  if (details === undefined) {
    const content = result.content[0];
    return new Text(content?.type === "text" ? (content.text ?? "") : "", 0, 0);
  }

  if (details.answer === null) {
    return new Text(theme.fg("warning", "Cancelled"), 0, 0);
  }

  if (details.wasCustom === true) {
    return new Text(
      theme.fg("success", "✓ ") +
        theme.fg("muted", "(wrote) ") +
        theme.fg("accent", details.answer),
      0,
      0,
    );
  }

  const idx = details.options.indexOf(details.answer) + 1;
  const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
  return new Text(theme.fg("success", "✓ ") + theme.fg("accent", display), 0, 0);
};

export default function question(msa: ExtensionAPI) {
  msa.registerTool({
    description:
      "Ask the user a question and let them pick from options. Use when you need user input to proceed.",
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") return unavailableResult(params);
          if (params.options.length === 0) return noOptionsResult(params);

          const allOptions: DisplayOption[] = [
            ...params.options,
            { label: "Type something.", isOther: true },
          ];

          const result = yield* Effect.promise(() =>
            ctx.ui.custom<QuestionAnswer | null>((tui, theme, _kb, done) =>
              askQuestion({ tui, theme, question: params.question, options: allOptions, done }),
            ),
          );

          return answerResult(params, result);
        }),
      ),
    executionMode: "sequential",
    label: "Question",
    name: "question",
    parameters: QuestionParams,
    renderCall,
    renderResult,
  });
}
