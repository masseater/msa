import type codingAgentTypes from "@msa/coding-agent/index.types";

const CUSTOM_MESSAGE = "\x1b[38;2;155;86;63mWorking... (custom)\x1b[39m";
const CUSTOM_INDICATOR = { frames: ["\x1b[38;2;155;86;63m●\x1b[39m"] };

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("session_start", (_event, ctx) => {
    ctx.ui.setWorkingMessage(CUSTOM_MESSAGE);
    ctx.ui.setWorkingIndicator(CUSTOM_INDICATOR);
  });
}
