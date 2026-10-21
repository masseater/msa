declare namespace scrollWindowTypes {
  interface ViewFrame {
    header: string[];
    body: string[];
    footer: string[];

    cursorLine?: number | undefined;

    cursorEnd?: number | undefined;

    borderIndex?: number | undefined;
  }

  interface FittedView {
    lines: string[];

    offset: number;

    above: number;

    below: number;
  }
}

export type { scrollWindowTypes as default };
