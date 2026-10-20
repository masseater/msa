import type trustSelectorTypes from "./trust-selector.types.ts";
import type userMessageSelectorTypes from "./user-message-selector.types.ts";
import type userMessageTypes from "./user-message.types.ts";
import type visualTruncateTypes from "./visual-truncate.types.ts";

declare namespace componentsTypesPart4 {
  type TrustSelectorComponent = trustSelectorTypes.TrustSelectorComponent;
  type UserMessageComponent = userMessageTypes.UserMessageComponent;
  type UserMessageSelectorComponent = userMessageSelectorTypes.UserMessageSelectorComponent;
  type VisualTruncateResult = visualTruncateTypes.VisualTruncateResult;
}

export type { componentsTypesPart4 as default };
