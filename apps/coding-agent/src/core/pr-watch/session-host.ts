import type telemetryTypes from "@msa/telemetry/index.types";

import textModule from "../../utils/text.ts";
import type sessionHostTypes from "./session-host.types.ts";
import type watchTypes from "./watch.types.ts";

const { shortId } = textModule;

const PR_WATCH_MESSAGE_TYPE = "msa.pr_watch";

function record(
  telemetry: telemetryTypes.TelemetryContext,
  notification: watchTypes.PrNotification,
): void {
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

function createPrWatchHost(delivery: sessionHostTypes.PrWatchDelivery): watchTypes.PrWatchHost {
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

const sessionHost = {
  PR_WATCH_MESSAGE_TYPE,
  createPrWatchHost,
};

export default sessionHost;
