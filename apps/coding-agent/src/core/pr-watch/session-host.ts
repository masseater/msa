import type telemetryTypes from "@msa/telemetry/index.types";

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
  readonly telemetry: telemetryTypes.TelemetryContext;
}

function record(telemetry: telemetryTypes.TelemetryContext, notification: PrNotification): void {
  telemetry.log({
    attributes: {
      "msa.pr_watch.label": notification.label,
      "msa.pr_watch.text": notification.text,
      "msa.pr_watch.wake": notification.wake,
    },
    body: "msa.pr_watch.notification",
    severity: "info",
  });
  if (notification.ci === undefined) return;
  telemetry.recordMetric({
    attributes: { "msa.ci.conclusion": notification.ci.conclusion },
    description: "Time a watched pull request waited for its checks to finish",
    kind: "histogram",
    name: "msa.pr_watch.ci.duration",
    unit: "s",
    value: notification.ci.durationMs / 1000,
  });
}

export function createPrWatchHost(delivery: PrWatchDelivery): PrWatchHost {
  const thread = shortId(delivery.threadId);
  return {
    changed: () => delivery.changed(),
    notify: (notification) => {
      record(delivery.telemetry, notification);
      const content = thread === "" ? notification.text : `${notification.text} [${thread}]`;
      delivery.sendMessage(
        { content, customType: PR_WATCH_MESSAGE_TYPE, display: true },
        { deliverAs: "steer", triggerTurn: notification.wake },
      );
    },
  };
}
