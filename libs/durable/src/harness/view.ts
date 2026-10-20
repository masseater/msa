import ConversationViews from "./conversation-views.ts";

function conversationViews(harness: object): ConversationViews {
  return ConversationViews.of(harness);
}

const view = {
  ConversationViews,
  conversationViews,
};

export default view;
