import chromeKit from "./index-kit/chrome.ts";
import dialogsKit from "./index-kit/dialogs.ts";
import messagesKit from "./index-kit/messages.ts";
import selectorsKit from "./index-kit/selectors.ts";

const components: typeof messagesKit & typeof selectorsKit & typeof dialogsKit & typeof chromeKit =
  {
    ...messagesKit,
    ...selectorsKit,
    ...dialogsKit,
    ...chromeKit,
  };

export default components;
