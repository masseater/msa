import type { OverlayHandle } from "@msa/tui";

let handle: OverlayHandle | null = null;

export const getGlobalToggleHandle = (): OverlayHandle | null => handle;

export const setGlobalToggleHandle = (next: OverlayHandle | null): void => {
  handle = next;
};
