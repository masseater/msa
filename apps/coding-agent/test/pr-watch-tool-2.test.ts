import telemetryModule from "@msa/telemetry";
import { describe, expect, it } from "vite-plus/test";

import { PR_WATCH_MESSAGE_TYPE, createPrWatchHost } from "../src/core/pr-watch/session-host.ts";

const { InMemoryTelemetryContext, NOOP_TELEMETRY_CONTEXT } = telemetryModule;

const sendsAChangeAsAMessageThat = () => {
  const sent: Array<{ message: unknown; options: unknown }> = [];
  const host = createPrWatchHost({
    changed: () => undefined,
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
    telemetry: NOOP_TELEMETRY_CONTEXT,
    threadId: "01a1518a-ff46-75e6-90be-7024913caa86",
  });

  host.notify({
    label: "CI failed",
    text: "#12: CI finished: 1 failed. Fix the failing checks.",
    wake: true,
  });

  expect(sent).toEqual([
    {
      message: {
        content: "#12: CI finished: 1 failed. Fix the failing checks. [01a1518a]",
        customType: PR_WATCH_MESSAGE_TYPE,
        display: true,
      },
      options: { deliverAs: "steer", triggerTurn: true },
    },
  ]);
};

const logsEachNotificationAndRecordsHowLong = () => {
  const telemetry = new InMemoryTelemetryContext();
  const host = createPrWatchHost({
    changed: () => undefined,
    sendMessage: () => undefined,
    telemetry,
    threadId: "",
  });

  host.notify({
    ci: { conclusion: "passed", durationMs: 90_000 },
    label: "CI passed",
    text: "#12: CI finished: 2 passed.",
    wake: true,
  });

  expect(telemetry.getLogs()).toEqual([
    {
      attributes: {
        "msa.pr_watch.label": "CI passed",
        "msa.pr_watch.text": "#12: CI finished: 2 passed.",
        "msa.pr_watch.wake": true,
      },
      body: "msa.pr_watch.notification",
      severity: "info",
      spanId: null,
    },
  ]);
  expect(telemetry.getMetrics()).toEqual([
    {
      attributes: { "msa.ci.conclusion": "passed" },
      kind: "histogram",
      name: "msa.pr_watch.ci.duration",
      unit: "s",
      value: 90,
    },
  ]);
};

const sendsAStatusReportWithoutStartingA = () => {
  const sent: Array<{ message: unknown; options: unknown }> = [];
  const host = createPrWatchHost({
    changed: () => undefined,
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
    telemetry: NOOP_TELEMETRY_CONTEXT,
    threadId: "01a1518a-ff46-75e6-90be-7024913caa86",
  });

  host.notify({ label: "status", text: "#12: checks running (verify), mergeable", wake: false });

  expect(sent).toEqual([
    {
      message: {
        content: "#12: checks running (verify), mergeable [01a1518a]",
        customType: PR_WATCH_MESSAGE_TYPE,
        display: true,
      },
      options: { deliverAs: "steer", triggerTurn: false },
    },
  ]);
};

const tagsTheSameTextFromTwoThreads = () => {
  const content = (threadId: string) => {
    const sent: Array<{ message: { content: string } }> = [];
    createPrWatchHost({
      changed: () => undefined,
      sendMessage: (message) => {
        sent.push({ message });
      },
      telemetry: NOOP_TELEMETRY_CONTEXT,
      threadId,
    }).notify({ label: "status", text: "#12: checks running", wake: false });
    return sent[0]?.message.content;
  };

  expect(content("aaaaaaaa-0000-0000-0000-000000000001")).toBe("#12: checks running [aaaaaaaa]");
  expect(content("bbbbbbbb-0000-0000-0000-000000000002")).toBe("#12: checks running [bbbbbbbb]");
};

describe("pr_watch delivery", () => {
  it(
    "sends a change as a message that starts a turn when the session is idle",
    sendsAChangeAsAMessageThat,
  );

  it(
    "logs each notification and records how long CI waited",
    logsEachNotificationAndRecordsHowLong,
  );

  it("sends a status report without starting a turn", sendsAStatusReportWithoutStartingA);

  it("tags the same text from two threads with their own id", tagsTheSameTextFromTwoThreads);
});
