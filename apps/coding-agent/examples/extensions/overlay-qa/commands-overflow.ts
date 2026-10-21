import type codingAgentTypes from "@msa/coding-agent/index.types";

import showOverlayModule from "./show-overlay.ts";
import StreamingOverflowComponent from "./streaming-overflow-component.ts";

const { registerOverlayCommand } = showOverlayModule;
const registerOverflow = (msa: codingAgentTypes.ExtensionAPI): void => {
  registerOverlayCommand({
    component: () => (tui, theme, _kb, done) => new StreamingOverflowComponent(tui, theme, done),
    description: "Test width overflow with streaming process output",
    msa,
    name: "overlay-overflow",
    overlayOptions: { anchor: "center", maxHeight: 20, width: 90 },
  });
};

const registerOverflowCommand = (msa: codingAgentTypes.ExtensionAPI): void => {
  registerOverflow(msa);
};

const commandsOverflow = {
  registerOverflowCommand,
};

export default commandsOverflow;
