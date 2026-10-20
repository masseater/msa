declare namespace altScreenViewportKeysTypes {
  interface ViewportKeyTarget {
    toggleSearch(): void;
    isSearchFocused(): boolean;
    navigateSearch(direction: -1 | 1): void;
    closeSearch(): void;
    shouldDeferToOverlay(): boolean;
    viewportHeight(): number;
    scrollBy(lines: number): void;
    scrollToPrompt(direction: -1 | 1): void;
    scrollToTop(): void;
    scrollToBottom(): void;
  }

  interface PromptSearch {
    from: number;
    direction: -1 | 1;
  }
}

export type { altScreenViewportKeysTypes as default };
