declare namespace editReplacementTypes {
  type EditMode = "multi" | "single";

  interface Replacement {
    readonly oldBytes: number;
    readonly newBytes: number;
    readonly totalEditBytes: number;
    readonly sharedPrefixBytes: number;
    readonly sharedSuffixBytes: number;
    readonly sharedContextBytes: number;
    readonly coreOldBytes: number;
    readonly coreNewBytes: number;
    readonly coreBytes: number;
    readonly wrapperPayloadBytes: number;
    readonly inflationRatio: number | null;
    readonly noCoreChange: boolean;
  }

  interface EditAnalysis {
    readonly path: string;
    readonly extension: string;
    readonly mode: EditMode;
    readonly argStyle: string;
    readonly editsCount: number;
    readonly oldBytes: number;
    readonly newBytes: number;
    readonly totalEditBytes: number;
    readonly sharedPrefixBytes: number;
    readonly sharedSuffixBytes: number;
    readonly sharedContextBytes: number;
    readonly coreOldBytes: number;
    readonly coreNewBytes: number;
    readonly coreBytes: number;
    readonly wrapperPayloadBytes: number;
    readonly noCoreChange?: boolean;
    readonly noCoreChangeCount?: number;
    readonly inflationRatio: number | null;
    readonly medianEditInflationRatio: number | null;
    readonly maxEditInflationRatio: number | null;
    readonly perEdit: ReadonlyArray<Replacement>;
  }
}

export type { editReplacementTypes as default };
