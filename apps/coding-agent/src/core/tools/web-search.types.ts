import type { Static } from "typebox";

import type truncateTypes from "./truncate.types.ts";
import type webSearch from "./web-search.ts";

declare namespace webSearchTypes {
  type WebSearchToolInput = Static<typeof webSearch.webSearchSchema>;

  interface WebSearchResultSummary {
    title: string;
    url?: string;
  }

  interface WebSearchToolDetails {
    results: WebSearchResultSummary[];
    servedBy?: string;
    costMicro?: number;
    truncation?: truncateTypes.TruncationResult;
  }
}

export type { webSearchTypes as default };
