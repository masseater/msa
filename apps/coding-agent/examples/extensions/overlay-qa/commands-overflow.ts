import type { ExtensionAPI } from "@msa/coding-agent";

import { registerOverlayCommand } from "./show-overlay.ts";
import { StreamingOverflowComponent } from "./streaming-overflow-component.ts";

const registerOverflow = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    component: () => (tui, theme, _kb, done) => new StreamingOverflowComponent(tui, theme, done),
    description: "Test width overflow with streaming process output",
    msa,
    name: "overlay-overflow",
    overlayOptions: { anchor: "center", maxHeight: 20, width: 90 },
  });
};

export const registerOverflowCommand = (msa: ExtensionAPI): void => {
  registerOverflow(msa);
};
