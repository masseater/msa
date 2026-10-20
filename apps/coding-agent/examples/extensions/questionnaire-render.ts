import type { Theme } from "@msa/coding-agent";
import tui from "@msa/tui";

import type { QuestionnaireState, RenderOption } from "./questionnaire-types.ts";

const { visibleWidth, wrapTextWithAnsi } = tui;

const currentQuestion = (state: QuestionnaireState) => state.questions[state.currentTab];

const currentOptions = (state: QuestionnaireState): RenderOption[] => {
  const question = currentQuestion(state);
  if (question === undefined) return [];

  const options: RenderOption[] = [...question.options];
  if (question.allowOther) {
    options.push({ isOther: true, label: "Type something.", value: "__other__" });
  }
  return options;
};

const appendWrapped = (lines: string[], text: string, width: number): void => {
  lines.push(...wrapTextWithAnsi(text, width));
};

const appendWrappedWithPrefix = (
  lines: string[],
  prefix: string,
  text: string,
  width: number,
): void => {
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) {
    appendWrapped(lines, prefix + text, width);
    return;
  }

  const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
  const continuationPrefix = " ".repeat(prefixWidth);
  for (let i = 0; i < wrapped.length; i++) {
    lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
  }
};

const tabBar = (state: QuestionnaireState, theme: Theme): string => {
  const tabs: string[] = ["← "];
  for (const [i, question] of state.questions.entries()) {
    const isActive = i === state.currentTab;
    const isAnswered = state.answers.has(question.id);
    const text = ` ${isAnswered ? "■" : "□"} ${question.label} `;
    const styled = isActive
      ? theme.bg("selectedBg", theme.fg("text", text))
      : theme.fg(isAnswered ? "success" : "muted", text);
    tabs.push(`${styled} `);
  }

  const canSubmit = state.questions.every((q) => state.answers.has(q.id));
  const submitText = " ✓ Submit ";
  const submitStyled =
    state.currentTab === state.questions.length
      ? theme.bg("selectedBg", theme.fg("text", submitText))
      : theme.fg(canSubmit ? "success" : "dim", submitText);
  tabs.push(`${submitStyled} →`);
  return tabs.join("");
};

const appendOptions = (
  lines: string[],
  state: QuestionnaireState,
  theme: Theme,
  width: number,
): void => {
  for (const [i, opt] of currentOptions(state).entries()) {
    const selected = i === state.optionIndex;
    const isOther = opt.isOther === true;
    const prefix = selected ? theme.fg("accent", "> ") : "  ";
    const label = `${i + 1}. ${opt.label}${isOther && state.inputMode ? " ✎" : ""}`;
    const color = selected || (isOther && state.inputMode) ? "accent" : "text";

    appendWrappedWithPrefix(lines, prefix, theme.fg(color, label), width);
    if (opt.description !== undefined && opt.description.length > 0) {
      appendWrappedWithPrefix(lines, "     ", theme.fg("muted", opt.description), width);
    }
  }
};

const appendInputMode = (
  lines: string[],
  state: QuestionnaireState,
  theme: Theme,
  width: number,
): void => {
  const question = currentQuestion(state);
  if (question === undefined) return;

  appendWrappedWithPrefix(lines, " ", theme.fg("text", question.prompt), width);
  lines.push("");
  appendOptions(lines, state, theme, width);
  lines.push("");
  appendWrappedWithPrefix(lines, " ", theme.fg("muted", "Your answer:"), width);
  for (const line of state.editor.render(Math.max(1, width - 2))) {
    lines.push(` ${line}`);
  }
  lines.push("");
  appendWrappedWithPrefix(lines, " ", theme.fg("dim", "Enter to submit • Esc to cancel"), width);
};

const appendSubmitTab = (
  lines: string[],
  state: QuestionnaireState,
  theme: Theme,
  width: number,
): void => {
  appendWrappedWithPrefix(lines, " ", theme.fg("accent", theme.bold("Ready to submit")), width);
  lines.push("");

  for (const question of state.questions) {
    const answer = state.answers.get(question.id);
    if (answer === undefined) continue;
    const prefix = answer.wasCustom ? "(wrote) " : "";
    appendWrappedWithPrefix(
      lines,
      " ",
      `${theme.fg("muted", `${question.label}: `)}${theme.fg("text", prefix + answer.label)}`,
      width,
    );
  }

  lines.push("");
  const missing = state.questions.filter((q) => !state.answers.has(q.id));
  if (missing.length === 0) {
    appendWrappedWithPrefix(lines, " ", theme.fg("success", "Press Enter to submit"), width);
    return;
  }
  appendWrappedWithPrefix(
    lines,
    " ",
    theme.fg("warning", `Unanswered: ${missing.map((q) => q.label).join(", ")}`),
    width,
  );
};

export const renderQuestionnaire = (request: {
  readonly state: QuestionnaireState;
  readonly theme: Theme;
  readonly width: number;
}): string[] => {
  const { state, theme, width } = request;
  if (state.cachedLines !== undefined && state.cachedLines.length > 0) return state.cachedLines;

  const lines: string[] = [];
  const renderWidth = Math.max(1, width);
  lines.push(theme.fg("accent", "─".repeat(renderWidth)));

  if (state.isMulti) {
    appendWrappedWithPrefix(lines, " ", tabBar(state, theme), renderWidth);
    lines.push("");
  }

  if (state.inputMode) {
    appendInputMode(lines, state, theme, renderWidth);
  } else if (state.currentTab === state.questions.length) {
    appendSubmitTab(lines, state, theme, renderWidth);
  } else {
    const question = currentQuestion(state);
    if (question !== undefined) {
      appendWrappedWithPrefix(lines, " ", theme.fg("text", question.prompt), renderWidth);
      lines.push("");
      appendOptions(lines, state, theme, renderWidth);
    }
  }

  lines.push("");
  if (!state.inputMode) {
    const help = state.isMulti
      ? "Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
      : "↑↓ navigate • Enter select • Esc cancel";
    appendWrappedWithPrefix(lines, " ", theme.fg("dim", help), renderWidth);
  }
  lines.push(theme.fg("accent", "─".repeat(renderWidth)));

  state.cachedLines = lines;
  return lines;
};
