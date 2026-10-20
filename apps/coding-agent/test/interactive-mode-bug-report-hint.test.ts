import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { describe, expect, test, vi } from "vite-plus/test";

import interactiveModeSupport from "../src/modes/interactive/interactive-mode-support.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { formatCrashExtensionHint } = interactiveModeSupport;

const { fauxAssistantMessage } = ai;

function errorMessage(message: string): aiTypes.AssistantMessage {
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

  for (const failure of failures)
    bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(errorMessage(failure));

  expect(context.suggestBugReport).not.toHaveBeenCalled();
};

const doesNotSuggestReportsForCancellations = () => {
  const context = {
    maybeShowInstallChangeWarning: vi.fn(() => false),
    suggestBugReport: vi.fn(),
  };

  bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(
    errorMessage("This operation was aborted"),
  );
  bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(
    errorMessage("Request cancelled"),
  );
  bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(
    fauxAssistantMessage("", { stopReason: "aborted" }),
  );

  expect(context.suggestBugReport).not.toHaveBeenCalled();
};

const suggestsReportsForUnexpectedErrors = () => {
  const context = {
    maybeShowInstallChangeWarning: vi.fn(() => false),
    suggestBugReport: vi.fn(),
  };

  bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(
    errorMessage("Unexpected internal state"),
  );

  expect(context.suggestBugReport).toHaveBeenCalledOnce();
};

const showsTheInstallChangeWarningInsteadOf = () => {
  const context = { maybeShowInstallChangeWarning: vi.fn(() => true), suggestBugReport: vi.fn() };

  bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(
    errorMessage("Cannot find module './worker.js'"),
  );

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
