import type tuiTypes from "@msa/tui/index.types";

let handle: tuiTypes.OverlayHandle | null = null;

export const getGlobalToggleHandle = (): tuiTypes.OverlayHandle | null => handle;

export const setGlobalToggleHandle = (next: tuiTypes.OverlayHandle | null): void => {
  handle = next;
};
