import { dual } from "effect/Function";

import { startsWithOsc133PromptStart } from "./ansi-sequences.ts";
import type { Keybinding } from "./keybinding-definitions.ts";
import { getKeybindings } from "./keybindings.ts";
import { isKeyRelease } from "./keys.ts";

const PAGE_SCROLL_OVERLAP = 4;

export interface ViewportKeyTarget {
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

export interface PromptSearch {
  from: number;
  direction: -1 | 1;
}

type ViewportKeyAction = readonly [Keybinding, (target: ViewportKeyTarget) => void];

const SEARCH_KEYS: readonly ViewportKeyAction[] = [
  ["tui.altScreen.searchNext", (target) => target.navigateSearch(1)],
  ["tui.altScreen.searchPrevious", (target) => target.navigateSearch(-1)],
  ["tui.altScreen.searchClose", (target) => target.closeSearch()],
];

const pageLines = (target: ViewportKeyTarget): number =>
  Math.max(1, target.viewportHeight() - PAGE_SCROLL_OVERLAP);
const halfPageLines = (target: ViewportKeyTarget): number =>
  Math.max(1, Math.floor(target.viewportHeight() / 2));

const VIEWPORT_KEYS: readonly ViewportKeyAction[] = [
  ["tui.altScreen.pageUp", (target) => target.scrollBy(-pageLines(target))],
  ["tui.altScreen.pageDown", (target) => target.scrollBy(pageLines(target))],
  ["tui.altScreen.halfPageUp", (target) => target.scrollBy(-halfPageLines(target))],
  ["tui.altScreen.halfPageDown", (target) => target.scrollBy(halfPageLines(target))],
  ["tui.altScreen.lineUp", (target) => target.scrollBy(-1)],
  ["tui.altScreen.lineDown", (target) => target.scrollBy(1)],
  ["tui.altScreen.previousPrompt", (target) => target.scrollToPrompt(-1)],
  ["tui.altScreen.nextPrompt", (target) => target.scrollToPrompt(1)],
  ["tui.altScreen.top", (target) => target.scrollToTop()],
  ["tui.altScreen.bottom", (target) => target.scrollToBottom()],
];

export const handleViewportKey: {
  (data: string, target: ViewportKeyTarget): { consume?: boolean } | undefined;
  (target: ViewportKeyTarget): (data: string) => { consume?: boolean } | undefined;
} = dual(2, (data: string, target: ViewportKeyTarget): { consume?: boolean } | undefined => {
  const keybindings = getKeybindings();
  const isRelease = isKeyRelease(data);
  const run = (action: (target: ViewportKeyTarget) => void): { consume: boolean } => {
    if (!isRelease) action(target);
    return { consume: true };
  };
  const find = (actions: readonly ViewportKeyAction[]): ViewportKeyAction | undefined =>
    actions.find(([binding]) => keybindings.matches(data, binding));
  if (keybindings.matches(data, "tui.altScreen.search")) return run((t) => t.toggleSearch());
  const searchAction = target.isSearchFocused() ? find(SEARCH_KEYS) : undefined;
  if (searchAction !== undefined) return run(searchAction[1]);
  if (target.shouldDeferToOverlay()) return undefined;
  const action = find(VIEWPORT_KEYS);
  return action === undefined ? undefined : run(action[1]);
});

export const findPromptRow: {
  (lines: readonly string[], search: PromptSearch): number | undefined;
  (search: PromptSearch): (lines: readonly string[]) => number | undefined;
} = dual(2, (lines: readonly string[], { from, direction }: PromptSearch): number | undefined => {
  for (let row = from + direction; row >= 0 && row < lines.length; row += direction) {
    if (startsWithOsc133PromptStart(lines[row] ?? "")) return row;
  }
  return undefined;
});
