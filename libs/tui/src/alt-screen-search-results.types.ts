import type altScreenSearchTypes from "./alt-screen-search.types.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import type layoutTypes from "./layout.types.ts";

declare namespace altScreenSearchResultsTypes {
  type SearchSelectionMode = "query" | "retain" | "next" | "previous";

  interface SearchSelectionState {
    selectionMode: SearchSelectionMode;
    anchorRow: number;
    selectedIndex: number;
  }

  interface SearchHighlightStyles {
    match: (text: string) => string;
    current: (text: string) => string;
  }

  interface SearchHighlightRequest {
    matches: readonly altScreenSearchTypes.AltScreenSearchMatch[];
    selectedIndex: number;
    box: layoutTypes.LayoutBox;
    scrollView: scrollViewTypes.ScrollView;
    columns: number;
    styles: SearchHighlightStyles;
  }
}

export type { altScreenSearchResultsTypes as default };
