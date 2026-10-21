import session from "./session.ts";
import text from "./text.ts";
import uiContext from "./ui-context.ts";

const harness = {
  createHarness: session.createHarness,
  createTestUiContext: uiContext.createTestUiContext,
  getAssistantTexts: text.getAssistantTexts,
  getMessageText: text.getMessageText,
  getToolResult: text.getToolResult,
  getUserTexts: text.getUserTexts,
};

export default harness;
