declare namespace questionUiTypes {
  interface OptionWithDesc {
    label: string;
    description?: string;
  }

  type DisplayOption = OptionWithDesc & { isOther?: boolean };

  interface QuestionAnswer {
    answer: string;
    wasCustom: boolean;
    index?: number;
  }
}

export type { questionUiTypes as default };
