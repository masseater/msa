import { dual } from "effect/Function";

import type altScreenViewportKeysTypes from "./alt-screen-viewport-keys.types.ts";
import ansiSequences from "./ansi-sequences.ts";
import type keybindingDefinitionsTypes from "./keybinding-definitions.types.ts";
import keybindingsModule from "./keybindings.ts";
import keys from "./keys.ts";

const { getKeybindings } = keybindingsModule;
const { isKeyRelease } = keys;
const { startsWithOsc133PromptStart } = ansiSequences;

const PAGE_SCROLL_OVERLAP = 4;

type ViewportKeyAction = readonly [
  keybindingDefinitionsTypes.Keybinding,
  (target: altScreenViewportKeysTypes.ViewportKeyTarget) => void,
];

const SEARCH_KEYS: readonly ViewportKeyAction[] = [
  ["tui.altScreen.searchNext", (target) => target.navigateSearch(1)],
  ["tui.altScreen.searchPrevious", (target) => target.navigateSearch(-1)],
  ["tui.altScreen.searchClose", (target) => target.closeSearch()],
];

const pageLines = (target: altScreenViewportKeysTypes.ViewportKeyTarget): number =>
  Math.max(1, target.viewportHeight() - PAGE_SCROLL_OVERLAP);
const halfPageLines = (target: altScreenViewportKeysTypes.ViewportKeyTarget): number =>
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

const handleViewportKey: {
  (
    data: string,
    target: altScreenViewportKeysTypes.ViewportKeyTarget,
  ): { consume?: boolean } | undefined;
  (
    target: altScreenViewportKeysTypes.ViewportKeyTarget,
  ): (data: string) => { consume?: boolean } | undefined;
} = dual(
  2,
  (
    data: string,
    target: altScreenViewportKeysTypes.ViewportKeyTarget,
  ): { consume?: boolean } | undefined => {
    const keybindings = getKeybindings();
    const isRelease = isKeyRelease(data);
    const run = (
      action: (target: altScreenViewportKeysTypes.ViewportKeyTarget) => void,
    ): { consume: boolean } => {
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
  },
);

const findPromptRow: {
  (lines: readonly string[], search: altScreenViewportKeysTypes.PromptSearch): number | undefined;
  (
    search: altScreenViewportKeysTypes.PromptSearch,
  ): (lines: readonly string[]) => number | undefined;
} = dual(
  2,
  (
    lines: readonly string[],
    { from, direction }: altScreenViewportKeysTypes.PromptSearch,
  ): number | undefined => {
    for (let row = from + direction; row >= 0 && row < lines.length; row += direction) {
      if (startsWithOsc133PromptStart(lines[row] ?? "")) return row;
    }
    return undefined;
  },
);

const altScreenViewportKeys = {
  findPromptRow,
  handleViewportKey,
};

export default altScreenViewportKeys;
