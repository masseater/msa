import type typesModule from "../types.types.ts";

declare namespace scanTypes {
  type ScanStart = {
    readonly order: typesModule.ScanOrder;
    readonly after: number | undefined;
  };
}

export type { scanTypes as default };
