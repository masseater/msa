import type { ExtensionAPI } from "@msa/coding-agent";

import { registerOverlayCommand } from "./show-overlay.ts";
import { StreamingOverflowComponent } from "./streaming-overflow-component.ts";

const registerOverflow = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    msa,
    name: "overlay-overflow",
    description: "Test width overflow with streaming process output",
    overlayOptions: { anchor: "center", width: 90, maxHeight: 20 },
    component: () => (tui, theme, _kb, done) => new StreamingOverflowComponent(tui, theme, done),
  });
};

export const registerOverflowCommand = (msa: ExtensionAPI): void => {
  registerOverflow(msa);
};
