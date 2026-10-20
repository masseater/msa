import type UIPromptTrackerClass from "./runner-ui-prompts.ts";

declare namespace runnerUiPromptsTypes {
  type UIPromptTracker = (typeof UIPromptTrackerClass)["prototype"];
}

export type { runnerUiPromptsTypes as default };
