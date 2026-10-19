import { shortId } from "../../utils/text.ts";
import type { PrWatchHost } from "./watch.ts";

export const PR_WATCH_MESSAGE_TYPE = "msa.pr_watch";

export interface PrWatchMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

export interface PrWatchDelivery {
  /** The session the notification is injected into, so the text says which thread it belongs to. */
  readonly threadId: string;
  readonly sendMessage: (
    message: PrWatchMessage,
    options: { readonly triggerTurn: boolean; readonly deliverAs: "steer" },
  ) => void;
  readonly changed: () => void;
}

export function createPrWatchHost(delivery: PrWatchDelivery): PrWatchHost {
  const thread = shortId(delivery.threadId);
  return {
    notify: (notification) => {
      const content = thread === "" ? notification.text : `${notification.text} [${thread}]`;
      delivery.sendMessage(
        { customType: PR_WATCH_MESSAGE_TYPE, content, display: true },
        { triggerTurn: notification.wake, deliverAs: "steer" },
      );
    },
    changed: () => delivery.changed(),
  };
}
