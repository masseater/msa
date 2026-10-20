declare namespace llamaCppClassifyTypes {
  interface LabeledQuestion {
    content: string;
    labels: string[];
    keys: string[];
  }
}

export type { llamaCppClassifyTypes as default };
