import closeAgentSessionModule from "../close-agent-session.ts";
import session from "./harness/session.ts";
import text from "./harness/text.ts";
import uiContext from "./harness/ui-context.ts";

const harness = {
  cleanupAll: closeAgentSessionModule.cleanupAll,
  createHarness: session.createHarness,
  createTestUiContext: uiContext.createTestUiContext,
  getAssistantTexts: text.getAssistantTexts,
  getMessageText: text.getMessageText,
  getToolResult: text.getToolResult,
  getUserTexts: text.getUserTexts,
};

export default harness;
