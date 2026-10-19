import type { Theme } from "@msa/coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@msa/tui";

export interface OptionWithDesc {
  label: string;
  description?: string;
}

export type DisplayOption = OptionWithDesc & { isOther?: boolean };

export interface QuestionAnswer {
  answer: string;
  wasCustom: boolean;
  index?: number;
}

interface QuestionState {
  readonly tui: TUI;
  readonly theme: Theme;
  readonly question: string;
  readonly options: DisplayOption[];
  readonly editor: Editor;
  readonly done: (result: QuestionAnswer | null) => void;
  optionIndex: number;
  editMode: boolean;
  cachedLines: string[] | undefined;
}

const editorTheme = (theme: Theme): EditorTheme => ({
  borderColor: (s) => theme.fg("accent", s),
  selectList: {
    selectedPrefix: (t) => theme.fg("accent", t),
    selectedText: (t) => theme.fg("accent", t),
    description: (t) => theme.fg("muted", t),
    scrollInfo: (t) => theme.fg("dim", t),
    noMatch: (t) => theme.fg("warning", t),
  },
});

const refresh = (state: QuestionState): void => {
  state.cachedLines = undefined;
  state.tui.requestRender();
};

const handleQuestionInput = (state: QuestionState, data: string): void => {
  if (state.editMode) {
    if (matchesKey(data, Key.escape)) {
      state.editMode = false;
      state.editor.setText("");
      refresh(state);
      return;
    }
    state.editor.handleInput(data);
    refresh(state);
    return;
  }

  if (matchesKey(data, Key.up)) {
    state.optionIndex = Math.max(0, state.optionIndex - 1);
    refresh(state);
    return;
  }
  if (matchesKey(data, Key.down)) {
    state.optionIndex = Math.min(state.options.length - 1, state.optionIndex + 1);
    refresh(state);
    return;
  }

  if (matchesKey(data, Key.enter)) {
    const selected = state.options[state.optionIndex];
    if (selected === undefined) return;
    if (selected.isOther === true) {
      state.editMode = true;
      refresh(state);
    } else {
      state.done({ answer: selected.label, wasCustom: false, index: state.optionIndex + 1 });
    }
    return;
  }

  if (matchesKey(data, Key.escape)) {
    state.done(null);
  }
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

const appendOptions = (lines: string[], state: QuestionState, width: number): void => {
  for (const [i, opt] of state.options.entries()) {
    const selected = i === state.optionIndex;
    const isOther = opt.isOther === true;
    const prefix = selected ? state.theme.fg("accent", "> ") : "  ";
    const label = `${i + 1}. ${opt.label}${isOther && state.editMode ? " ✎" : ""}`;
    const color = selected || (isOther && state.editMode) ? "accent" : "text";

    appendWrappedWithPrefix(lines, prefix, state.theme.fg(color, label), width);

    if (opt.description !== undefined && opt.description.length > 0) {
      appendWrappedWithPrefix(lines, "     ", state.theme.fg("muted", opt.description), width);
    }
  }
};

const appendEditor = (lines: string[], state: QuestionState, width: number): void => {
  if (!state.editMode) return;
  lines.push("");
  appendWrappedWithPrefix(lines, " ", state.theme.fg("muted", "Your answer:"), width);
  for (const line of state.editor.render(Math.max(1, width - 2))) {
    lines.push(` ${line}`);
  }
};

const appendFooter = (lines: string[], state: QuestionState, width: number): void => {
  const hint = state.editMode
    ? "Enter to submit • Esc to go back"
    : "↑↓ navigate • Enter to select • Esc to cancel";
  lines.push("");
  appendWrappedWithPrefix(lines, " ", state.theme.fg("dim", hint), width);
  lines.push(state.theme.fg("accent", "─".repeat(width)));
};

const renderQuestion = (state: QuestionState, width: number): string[] => {
  if (state.cachedLines !== undefined && state.cachedLines.length > 0) return state.cachedLines;

  const lines: string[] = [];
  const renderWidth = Math.max(1, width);
  const separator = state.theme.fg("accent", "─".repeat(renderWidth));

  lines.push(separator);
  appendWrappedWithPrefix(lines, " ", state.theme.fg("text", state.question), renderWidth);
  lines.push("");
  appendOptions(lines, state, renderWidth);
  appendEditor(lines, state, renderWidth);
  appendFooter(lines, state, renderWidth);

  state.cachedLines = lines;
  return lines;
};

export const askQuestion = (request: {
  readonly tui: TUI;
  readonly theme: Theme;
  readonly question: string;
  readonly options: DisplayOption[];
  readonly done: (result: QuestionAnswer | null) => void;
}) => {
  const { tui, theme, question, options, done } = request;
  const state: QuestionState = {
    tui,
    theme,
    question,
    options,
    editor: new Editor(tui, editorTheme(theme)),
    done,
    optionIndex: 0,
    editMode: false,
    cachedLines: undefined,
  };

  state.editor.onSubmit = (value) => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      done({ answer: trimmed, wasCustom: true });
      return;
    }
    state.editMode = false;
    state.editor.setText("");
    refresh(state);
  };

  return {
    render: (width: number) => renderQuestion(state, width),
    invalidate: () => {
      state.cachedLines = undefined;
    },
    handleInput: (data: string) => handleQuestionInput(state, data),
  };
};
