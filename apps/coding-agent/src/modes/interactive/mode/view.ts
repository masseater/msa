import type InteractiveMode from "../interactive-mode.ts";
import ChatMessages from "./chat-messages.ts";
import ChatPanels from "./chat-panels.ts";
import CustomEntriesView from "./custom-entries.ts";
import CustomMessagesView from "./custom-messages.ts";
import SessionHistoryView from "./session-history.ts";
import SessionReplay from "./session-replay.ts";
import StreamingView from "./streaming.ts";
import ToolExecutionsView from "./tool-executions.ts";
import UserMessagesView from "./user-messages.ts";

export default class ChatView {
  readonly toolExecutions: ToolExecutionsView;
  readonly replay: SessionReplay;
  readonly panels: ChatPanels;
  readonly entries: CustomEntriesView;
  readonly customMessages: CustomMessagesView;
  readonly userMessages: UserMessagesView;
  readonly messages: ChatMessages;
  readonly history: SessionHistoryView;
  readonly streaming: StreamingView;

  constructor(mode: InteractiveMode) {
    this.toolExecutions = new ToolExecutionsView(mode);
    this.replay = new SessionReplay(mode);
    this.panels = new ChatPanels(mode);
    this.entries = new CustomEntriesView(mode);
    this.customMessages = new CustomMessagesView(mode);
    this.userMessages = new UserMessagesView(mode);
    this.messages = new ChatMessages(mode);
    this.history = new SessionHistoryView(mode);
    this.streaming = new StreamingView(mode);
  }
}
