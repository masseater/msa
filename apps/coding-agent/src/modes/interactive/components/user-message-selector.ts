import tui from "@msa/tui";

import platform from "../../../core/platform/index.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import UserMessageList from "./user-message-list.ts";

const { theme } = themeModule;
const { schedule } = platform;
const { Spacer, Text } = tui;

interface UserMessageItem {
  id: string;
  text: string;
  timestamp?: string;
}
export default class UserMessageSelectorComponent extends tui.Container {
  private messageList: UserMessageList;

  constructor(
    messages: UserMessageItem[],
    onSelect: (entryId: string) => void,
    onCancel: () => void,
    initialSelectedId?: string,
  ) {
    super();

    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.bold("Fork from Message"), 1, 0));
    this.addChild(
      new Text(
        theme.fg(
          "muted",
          "Select a user message to copy the active path up to that point into a new session",
        ),
        1,
        0,
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    this.messageList = new UserMessageList(messages, initialSelectedId);
    this.messageList.onSelect = onSelect;
    this.messageList.onCancel = onCancel;

    this.addChild(this.messageList);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());

    if (messages.length === 0) {
      schedule(() => onCancel(), 100);
    }
  }

  getMessageList(): UserMessageList {
    return this.messageList;
  }
}
