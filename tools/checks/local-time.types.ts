declare namespace localTimeTypes {
  type Finding = {
    readonly detail: string;
    readonly file: string;
    readonly line: number;
    readonly text: string;
  };
}

export type { localTimeTypes as default };
