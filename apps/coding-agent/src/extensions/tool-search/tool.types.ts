import type { Static } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type Bm25RankerClass from "./bm-25-ranker.ts";
import type tool from "./tool.ts";

declare namespace toolTypes {
  interface ToolSearchDocument {
    name: string;
    text: string;
  }

  interface ToolSearchMatch {
    name: string;
    score: number;
  }

  interface ToolRanker {
    rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[];
  }

  type ToolSearchInput = Static<typeof tool.toolSearchSchema>;

  interface ToolSearchResultTool {
    name: string;
    description: string;
  }

  interface ToolSearchToolDetails {
    loaded: string[];
  }

  interface ToolSearchToolOptions {
    tools?: Pick<
      extensionsTypesTypes.ExtensionAPI,
      "getAllTools" | "getActiveTools" | "setActiveTools"
    >;
  }

  type Bm25Ranker = (typeof Bm25RankerClass)["prototype"];
}

export type { toolTypes as default };
