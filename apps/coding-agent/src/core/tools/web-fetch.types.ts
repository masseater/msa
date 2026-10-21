import type { Static } from "typebox";

import type truncateTypes from "./truncate.types.ts";
import type webFetch from "./web-fetch.ts";

declare namespace webFetchTypes {
  type WebFetchToolInput = Static<typeof webFetch.webFetchSchema>;

  interface WebFetchToolDetails {
    title?: string;
    url: string;
    servedBy?: string;
    costMicro?: number;
    truncation?: truncateTypes.TruncationResult;
  }
}

export type { webFetchTypes as default };
