import type { Theme } from "@msa/coding-agent";
import type tuiTypes from "@msa/tui/index.types";

export interface QuestionOption {
  value: string;
  label: string;
  description?: string | undefined;
}

export type RenderOption = QuestionOption & { isOther?: boolean };

export interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
}

export interface Answer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number | undefined;
}

export interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

export interface QuestionnaireState {
  readonly questions: Question[];
  readonly isMulti: boolean;
  readonly totalTabs: number;
  readonly editor: tuiTypes.Editor;
  readonly done: (result: QuestionnaireResult) => void;
  readonly refresh: () => void;
  readonly answers: Map<string, Answer>;
  currentTab: number;
  optionIndex: number;
  inputMode: boolean;
  inputQuestionId: string | null;
  cachedLines: string[] | undefined;
}

export const editorTheme = (theme: Theme): tuiTypes.EditorTheme => ({
  borderColor: (s) => theme.fg("accent", s),
  selectList: {
    description: (t) => theme.fg("muted", t),
    noMatch: (t) => theme.fg("warning", t),
    scrollInfo: (t) => theme.fg("dim", t),
    selectedPrefix: (t) => theme.fg("accent", t),
    selectedText: (t) => theme.fg("accent", t),
  },
});
