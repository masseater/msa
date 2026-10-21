import type { Type } from "typebox";

import type chordTypes from "../../src/index.types.ts";
import type reload from "./reload.ts";

declare namespace reloadTypes {
  interface GreeterSpec {
    readonly greeting: string;
    readonly schema?: typeof reload.CountV1 | ReturnType<typeof Type.Object>;
    readonly initial?: object;
    readonly bump?: (draft: Record<string, number>) => void;
    readonly options?: chordTypes.ServeOptions;
    readonly state?: chordTypes.StateOptions<never>;
    readonly extra?: (self: chordTypes.Self, input: { id?: string }) => void;
  }
}

export type { reloadTypes as default };
