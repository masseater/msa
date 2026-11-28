declare namespace typedAccessTypes {
  type Finding = {
    readonly detail: string;
    readonly file: string;
    readonly line: number;
    readonly rule: "computed-key" | "extends-holder";
    readonly text: string;
  };
}

export type { typedAccessTypes as default };
