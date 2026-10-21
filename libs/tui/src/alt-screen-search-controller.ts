import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import type altScreenSearchComponentTypes from "./alt-screen-search-component.types.ts";
import altScreenSearchControllerKit from "./alt-screen-search-controller-kit.ts";
import type altScreenSearchControllerTypes from "./alt-screen-search-controller.types.ts";
import type altScreenSearchResultsTypes from "./alt-screen-search-results.types.ts";
import type altScreenSearchTypes from "./alt-screen-search.types.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import type layoutTypes from "./layout.types.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import type tuiOverlayLayoutTypes from "./tui-overlay-layout.types.ts";

const {
  altScreenMouseProtocol,
  altScreenSearch,
  AltScreenSearchComponent,
  altScreenSearchResults,
  layout: layoutModule,
} = altScreenSearchControllerKit;

const { AltScreenSearchIndex, getAltScreenSearchMatchKey } = altScreenSearch;
const { isPlainPress } = altScreenMouseProtocol;
const { getScrollViewBox } = layoutModule;
const { chooseSearchIndex, highlightSearchMatches } = altScreenSearchResults;

interface ActiveSearch {
  component: altScreenSearchComponentTypes.AltScreenSearchComponent;
  index: altScreenSearchTypes.AltScreenSearchIndex;
  overlay?: tuiInterfaceTypes.OverlayHandle;
  query: string;
  matches: altScreenSearchTypes.AltScreenSearchMatch[];
  selectedIndex: number;
  selectedKey?: string | undefined;
  anchorRow: number;
  selectionMode: altScreenSearchResultsTypes.SearchSelectionMode;
}

const SEARCH_OVERLAY: tuiOverlayLayoutTypes.OverlayOptions = {
  anchor: "top-right",
  margin: 1,
  minWidth: 32,
  width: "40%",
};

function revealMatch(
  scrollView: scrollViewTypes.ScrollView,
  match: altScreenSearchTypes.AltScreenSearchMatch | undefined,
): boolean {
  const firstSegment = match?.segments[0];
  const lastSegment = match?.segments[match.segments.length - 1];
  if (firstSegment === undefined || lastSegment === undefined || scrollView.viewportHeight <= 0)
    return false;
  const before = scrollView.scrollTop;
  const visibleBottom = before + scrollView.viewportHeight - 1;
  let target = before;
  if (firstSegment.row < before || lastSegment.row > visibleBottom) {
    target = firstSegment.row - Math.floor(scrollView.viewportHeight / 3);
  }
  scrollView.scrollTo(target, { disableFollow: true });
  return scrollView.scrollTop !== before;
}

export default class AltScreenSearchController {
  private readonly options: altScreenSearchControllerTypes.SearchControllerOptions;
  private active: ActiveSearch | undefined;

  constructor(options: altScreenSearchControllerTypes.SearchControllerOptions) {
    this.options = options;
  }

  isFocused(): boolean {
    return this.active?.overlay?.isFocused() === true;
  }

  toggle(): void {
    if (this.active !== undefined) {
      this.close();
      return;
    }
    const component = new AltScreenSearchComponent(
      (query) => this.updateQuery(query),
      this.options.navigationButtonStyle,
    );
    const search: ActiveSearch = {
      anchorRow: this.options.view.primaryScrollView().scrollTop,
      component,
      index: new AltScreenSearchIndex(),
      matches: [],
      query: "",
      selectedIndex: -1,
      selectionMode: "query",
    };
    this.active = search;
    search.overlay = this.options.showOverlay(component, { ...SEARCH_OVERLAY });
  }

  close(): void {
    const search = this.active;
    if (search === undefined) return;
    this.active = undefined;
    search.overlay?.hide();
    this.options.view.requestRender();
  }

  navigate(direction: -1 | 1): void {
    const search = this.active;
    if (search?.query === undefined || search?.query === "") return;
    search.selectionMode = direction < 0 ? "previous" : "next";
    this.options.view.requestRender();
  }

  clearHover(): boolean {
    return this.active?.component.setHoveredNavigationDirection(undefined) === true;
  }

  handleMouse(event: altScreenMouseProtocolTypes.SgrMouseEvent): boolean {
    const search = this.active;
    if (search === undefined) return false;
    const direction = this.navigationDirectionAt(search, event.x, event.y);
    if (search.component.setHoveredNavigationDirection(direction))
      this.options.view.requestRender();
    if (direction === undefined || !isPlainPress(event)) return false;
    this.navigate(direction);
    return true;
  }

  refresh(layout: layoutTypes.LayoutFrame, scrollView: scrollViewTypes.ScrollView): boolean {
    const search = this.active;
    if (search === undefined) return false;
    const box = getScrollViewBox(layout, scrollView);
    const lines = box?.scrollContentLines;
    if (lines === undefined || search.query.trim() === "") {
      search.matches = [];
      search.selectedIndex = -1;
      search.selectedKey = undefined;
      search.selectionMode = "retain";
      search.component.setResult(-1, 0);
      return false;
    }

    const shouldRevealSelection = search.selectionMode !== "retain";
    const result = search.index.search(lines, search.query);
    const matches = result.matches;
    search.matches = matches;
    if (!result.changed && search.selectionMode === "retain") return false;

    const exactIndex = result.changed
      ? search.selectedKey !== undefined && search.selectedKey !== ""
        ? matches.findIndex((match) => getAltScreenSearchMatchKey(match) === search.selectedKey)
        : -1
      : search.selectedIndex;
    const selectedIndex = chooseSearchIndex(search, matches, exactIndex);
    search.selectedIndex = selectedIndex;
    search.selectedKey =
      selectedIndex >= 0 ? getAltScreenSearchMatchKey(matches[selectedIndex]!) : undefined;
    search.selectionMode = "retain";
    search.component.setResult(selectedIndex, matches.length);
    if (!shouldRevealSelection || box === undefined) return false;
    return revealMatch(scrollView, matches[selectedIndex]);
  }

  highlight(
    screen: string[],
    layout: layoutTypes.LayoutFrame,
    scrollView: scrollViewTypes.ScrollView,
  ): string[] {
    const search = this.active;
    if (search === undefined || search.selectedIndex < 0 || search.matches.length === 0)
      return screen;
    const box: layoutTypes.LayoutBox | undefined = getScrollViewBox(layout, scrollView);
    if (box === undefined) return screen;
    return highlightSearchMatches(screen, {
      box,
      columns: this.options.view.columns(),
      matches: search.matches,
      scrollView,
      selectedIndex: search.selectedIndex,
      styles: this.options.styles,
    });
  }

  private updateQuery(query: string): void {
    const search = this.active;
    if (search === undefined || query === search.query) return;
    const selected = search.matches[search.selectedIndex];
    search.anchorRow =
      selected?.segments[0]?.row ?? this.options.view.primaryScrollView().scrollTop;
    search.query = query;
    search.selectionMode = "query";
    search.component.setResult(-1, 0);
    this.options.view.requestRender();
  }

  private navigationDirectionAt(search: ActiveSearch, x: number, y: number): -1 | 1 | undefined {
    const bounds = search.overlay?.getBounds();
    if (bounds === undefined) return undefined;
    if (
      x < bounds.col ||
      x >= bounds.col + bounds.width ||
      y < bounds.row ||
      y >= bounds.row + bounds.height
    ) {
      return undefined;
    }
    return search.component.getNavigationDirectionAt(y - bounds.row, x - bounds.col);
  }
}
