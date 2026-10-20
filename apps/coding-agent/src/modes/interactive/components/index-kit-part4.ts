import diff from "./diff.ts";
import keybindingHints from "./keybinding-hints.ts";
import UserMessageSelectorComponent from "./user-message-selector.ts";
import UserMessageComponent from "./user-message.ts";
import visualTruncate from "./visual-truncate.ts";

const indexKitPart4 = {
  UserMessageComponent: UserMessageComponent,
  UserMessageSelectorComponent: UserMessageSelectorComponent,
  keyHint: keybindingHints.keyHint,
  keyText: keybindingHints.keyText,
  rawKeyHint: keybindingHints.rawKeyHint,
  renderDiff: diff.renderDiff,
  truncateToVisualLines: visualTruncate.truncateToVisualLines,
};

export default indexKitPart4;
