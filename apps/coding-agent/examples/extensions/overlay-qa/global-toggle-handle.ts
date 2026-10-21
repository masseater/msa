import type tuiTypes from "@msa/tui/index.types";

let handle: tuiTypes.OverlayHandle | null = null;

const getGlobalToggleHandle = (): tuiTypes.OverlayHandle | null => handle;

const setGlobalToggleHandle = (next: tuiTypes.OverlayHandle | null): void => {
  handle = next;
};

const globalToggleHandle = {
  getGlobalToggleHandle,
  setGlobalToggleHandle,
};

export default globalToggleHandle;
