import type tuiTypes from "@msa/tui/index.types";

declare namespace questionnaireTypesTypes {
  interface QuestionOption {
    value: string;
    label: string;
    description?: string | undefined;
  }

  type RenderOption = QuestionOption & { isOther?: boolean };

  interface Question {
    id: string;
    label: string;
    prompt: string;
    options: QuestionOption[];
    allowOther: boolean;
  }

  interface Answer {
    id: string;
    value: string;
    label: string;
    wasCustom: boolean;
    index?: number | undefined;
  }

  interface QuestionnaireResult {
    questions: Question[];
    answers: Answer[];
    cancelled: boolean;
  }

  interface QuestionnaireState {
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
}

export type { questionnaireTypesTypes as default };
