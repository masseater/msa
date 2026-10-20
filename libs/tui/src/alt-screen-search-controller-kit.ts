import altScreenMouseProtocol from "./alt-screen-mouse-protocol.ts";
import AltScreenSearchComponent from "./alt-screen-search-component.ts";
import altScreenSearchResults from "./alt-screen-search-results.ts";
import altScreenSearch from "./alt-screen-search.ts";
import layout from "./layout.ts";

const altScreenSearchControllerKit: {
  readonly AltScreenSearchComponent: typeof AltScreenSearchComponent;
  readonly altScreenMouseProtocol: typeof altScreenMouseProtocol;
  readonly altScreenSearch: typeof altScreenSearch;
  readonly altScreenSearchResults: typeof altScreenSearchResults;
  readonly layout: typeof layout;
} = {
  AltScreenSearchComponent,
  altScreenMouseProtocol,
  altScreenSearch,
  altScreenSearchResults,
  layout,
};

export default altScreenSearchControllerKit;
