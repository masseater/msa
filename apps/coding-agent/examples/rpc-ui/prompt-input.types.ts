import type PromptInputClass from "./prompt-input.ts";

declare namespace promptInputTypes {
  type PromptInput = (typeof PromptInputClass)["prototype"];
}

export type { promptInputTypes as default };
