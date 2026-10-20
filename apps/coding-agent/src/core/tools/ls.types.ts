import type { Static } from "typebox";

import type ls from "./ls.ts";
import type truncateTypes from "./truncate.types.ts";

declare namespace lsTypes {
  type LsToolInput = Static<typeof ls.lsSchema>;

  interface LsToolDetails {
    truncation?: truncateTypes.TruncationResult;
    entryLimitReached?: number;
  }

  interface LsOperations {
    exists: (absolutePath: string) => Promise<boolean> | boolean;
    stat: (
      absolutePath: string,
    ) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean };
    readdir: (absolutePath: string) => Promise<string[]> | string[];
  }

  interface LsToolOptions {
    operations?: LsOperations;
  }
}

export type { lsTypes as default };
