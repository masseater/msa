import { isPlainPress, type SgrMouseEvent } from "./alt-screen-mouse-protocol.ts";
import { AltScreenSearchComponent } from "./alt-screen-search-component.ts";
import {
  chooseSearchIndex,
  highlightSearchMatches,
  type SearchHighlightStyles,
  type SearchSelectionMode,
} from "./alt-screen-search-results.ts";
import {
  AltScreenSearchIndex,
  type AltScreenSearchMatch,
  getAltScreenSearchMatchKey,
} from "./alt-screen-search.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { getScrollViewBox, type LayoutBox, type LayoutFrame } from "./layout.ts";
import type { Component } from "./tui-component.ts";
import type { OverlayHandle } from "./tui-interface.ts";
import type { OverlayOptions } from "./tui-overlay-layout.ts";

interface ActiveSearch {
  component: AltScreenSearchComponent;
  index: AltScreenSearchIndex;
  overlay?: OverlayHandle;
  query: string;
  matches: AltScreenSearchMatch[];
  selectedIndex: number;
  selectedKey?: string | undefined;
  anchorRow: number;
  selectionMode: SearchSelectionMode;
}

export interface SearchControllerOptions {
  view: AltScreenView;
  styles: SearchHighlightStyles;
  navigationButtonStyle: (text: string, hovered: boolean) => string;
  showOverlay: (component: Component, options: OverlayOptions) => OverlayHandle;
}

const SEARCH_OVERLAY: OverlayOptions = {
  anchor: "top-right",
  width: "40%",
  minWidth: 32,
  margin: 1,
};

function revealMatch(scrollView: ScrollView, match: AltScreenSearchMatch | undefined): boolean {
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

export class AltScreenSearchController {
  private readonly options: SearchControllerOptions;
  private active: ActiveSearch | undefined;

  constructor(options: SearchControllerOptions) {
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
      component,
      index: new AltScreenSearchIndex(),
      query: "",
      matches: [],
      selectedIndex: -1,
      anchorRow: this.options.view.primaryScrollView().scrollTop,
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

  handleMouse(event: SgrMouseEvent): boolean {
    const search = this.active;
    if (search === undefined) return false;
    const direction = this.navigationDirectionAt(search, event.x, event.y);
    if (search.component.setHoveredNavigationDirection(direction))
      this.options.view.requestRender();
    if (direction === undefined || !isPlainPress(event)) return false;
    this.navigate(direction);
    return true;
  }

  refresh(layout: LayoutFrame, scrollView: ScrollView): boolean {
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

  highlight(screen: string[], layout: LayoutFrame, scrollView: ScrollView): string[] {
    const search = this.active;
    if (search === undefined || search.selectedIndex < 0 || search.matches.length === 0)
      return screen;
    const box: LayoutBox | undefined = getScrollViewBox(layout, scrollView);
    if (box === undefined) return screen;
    return highlightSearchMatches(screen, {
      matches: search.matches,
      selectedIndex: search.selectedIndex,
      box,
      scrollView,
      columns: this.options.view.columns(),
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
