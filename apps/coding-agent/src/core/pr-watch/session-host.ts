import type { TelemetryContext } from "@msa/telemetry";

import { shortId } from "../../utils/text.ts";
import type { PrNotification, PrWatchHost } from "./watch.ts";

export const PR_WATCH_MESSAGE_TYPE = "msa.pr_watch";

export interface PrWatchMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

export interface PrWatchDelivery {
  readonly threadId: string;
  readonly sendMessage: (
    message: PrWatchMessage,
    options: { readonly triggerTurn: boolean; readonly deliverAs: "steer" },
  ) => void;
  readonly changed: () => void;
  readonly telemetry: TelemetryContext;
}

function record(telemetry: TelemetryContext, notification: PrNotification): void {
  telemetry.log({
    severity: "info",
    body: "msa.pr_watch.notification",
    attributes: {
      "msa.pr_watch.label": notification.label,
      "msa.pr_watch.text": notification.text,
      "msa.pr_watch.wake": notification.wake,
    },
  });
  if (notification.ci === undefined) return;
  telemetry.recordMetric({
    kind: "histogram",
    name: "msa.pr_watch.ci.duration",
    value: notification.ci.durationMs / 1000,
    unit: "s",
    description: "Time a watched pull request waited for its checks to finish",
    attributes: { "msa.ci.conclusion": notification.ci.conclusion },
  });
}

export function createPrWatchHost(delivery: PrWatchDelivery): PrWatchHost {
  const thread = shortId(delivery.threadId);
  return {
    notify: (notification) => {
      record(delivery.telemetry, notification);
      const content = thread === "" ? notification.text : `${notification.text} [${thread}]`;
      delivery.sendMessage(
        { customType: PR_WATCH_MESSAGE_TYPE, content, display: true },
        { triggerTurn: notification.wake, deliverAs: "steer" },
      );
    },
    changed: () => delivery.changed(),
  };
}
