import type { PrWatchHost } from "./watch.ts";

export const PR_WATCH_MESSAGE_TYPE = "msa.pr_watch";

export interface PrWatchMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

export interface PrWatchDelivery {
  readonly sendMessage: (
    message: PrWatchMessage,
    options: { readonly triggerTurn: boolean; readonly deliverAs: "steer" },
  ) => void;
  readonly changed: () => void;
}

export function createPrWatchHost(delivery: PrWatchDelivery): PrWatchHost {
  return {
    notify: (notification) => {
      delivery.sendMessage(
        { customType: PR_WATCH_MESSAGE_TYPE, content: notification.text, display: true },
        { triggerTurn: notification.wake, deliverAs: "steer" },
      );
    },
    changed: () => delivery.changed(),
  };
}
