import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import { describe, expect, test, vi } from "vite-plus/test";

import {
  InteractiveMode,
  formatCrashExtensionHint,
} from "../src/modes/interactive/interactive-mode.ts";

type BugReportHintContext = {
  suggestBugReport(): void;
  maybeShowInstallChangeWarning(): boolean;
};

const maybeSuggestBugReport = Reflect.get(InteractiveMode.prototype, "maybeSuggestBugReport") as (
  this: BugReportHintContext,
  message: AssistantMessage,
) => void;

function errorMessage(message: string): AssistantMessage {
  return fauxAssistantMessage("", { errorMessage: message, stopReason: "error" });
}

const identifiesExtensionsWithFramesInACrash = () => {
  expect(formatCrashExtensionHint(["npm:msa-observational-memory"])).toBe(
    "A stack frame came from loaded extension `npm:msa-observational-memory`, which may be involved. Try disabling it with `msa config`, or run `msa -ne` to confirm.",
  );
  expect(formatCrashExtensionHint(undefined)).toBeUndefined();
};

const doesNotSuggestReportsForRetryableProvider = () => {
  const context = {
    maybeShowInstallChangeWarning: vi.fn(() => false),
    suggestBugReport: vi.fn(),
  };
  const failures = [
    "500 Internal Server Error",
    "502 Bad Gateway",
    "503 Service Unavailable",
    "504 Gateway Timeout",
    "429 Too Many Requests",
    "Provider overloaded",
    "Network connection lost",
    "Request timed out",
  ];

  for (const failure of failures) maybeSuggestBugReport.call(context, errorMessage(failure));

  expect(context.suggestBugReport).not.toHaveBeenCalled();
};

const doesNotSuggestReportsForCancellations = () => {
  const context = {
    maybeShowInstallChangeWarning: vi.fn(() => false),
    suggestBugReport: vi.fn(),
  };

  maybeSuggestBugReport.call(context, errorMessage("This operation was aborted"));
  maybeSuggestBugReport.call(context, errorMessage("Request cancelled"));
  maybeSuggestBugReport.call(context, fauxAssistantMessage("", { stopReason: "aborted" }));

  expect(context.suggestBugReport).not.toHaveBeenCalled();
};

const suggestsReportsForUnexpectedErrors = () => {
  const context = {
    maybeShowInstallChangeWarning: vi.fn(() => false),
    suggestBugReport: vi.fn(),
  };

  maybeSuggestBugReport.call(context, errorMessage("Unexpected internal state"));

  expect(context.suggestBugReport).toHaveBeenCalledOnce();
};

const showsTheInstallChangeWarningInsteadOf = () => {
  const context = { maybeShowInstallChangeWarning: vi.fn(() => true), suggestBugReport: vi.fn() };

  maybeSuggestBugReport.call(context, errorMessage("Cannot find module './worker.js'"));

  expect(context.maybeShowInstallChangeWarning).toHaveBeenCalledOnce();
  expect(context.suggestBugReport).not.toHaveBeenCalled();
};

describe("InteractiveMode bug report hints", () => {
  test(
    "identifies extensions with frames in a crash stack",
    identifiesExtensionsWithFramesInACrash,
  );

  test(
    "does not suggest reports for retryable provider failures",
    doesNotSuggestReportsForRetryableProvider,
  );

  test("does not suggest reports for cancellations", doesNotSuggestReportsForCancellations);

  test("suggests reports for unexpected errors", suggestsReportsForUnexpectedErrors);

  test(
    "shows the install change warning instead of a bug report hint",
    showsTheInstallChangeWarningInsteadOf,
  );
});
