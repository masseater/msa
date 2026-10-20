import type { Type } from "typebox";

import type { Self, ServeOptions, StateOptions } from "../../src/index.ts";
import type reload from "./reload.ts";

declare namespace reloadTypes {
  interface GreeterSpec {
    readonly greeting: string;
    readonly schema?: typeof reload.CountV1 | ReturnType<typeof Type.Object>;
    readonly initial?: object;
    readonly bump?: (draft: Record<string, number>) => void;
    readonly options?: ServeOptions;
    readonly state?: StateOptions<never>;
    readonly extra?: (self: Self, input: { id?: string }) => void;
  }
}

export type { reloadTypes as default };
