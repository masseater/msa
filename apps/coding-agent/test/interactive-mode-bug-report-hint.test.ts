import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import interactiveModeSupport from "../src/modes/interactive/interactive-mode-support.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;
const { runTest } = testing;

const suggest = (context: object, message: aiTypes.AssistantMessage) =>
  Effect.promise(() =>
    bindModeFake(context).display.notices.warnings.maybeSuggestBugReport(message),
  );

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

const doesNotSuggestReportsForRetryableProvider = () =>
  runTest(
    Effect.gen(function* () {
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

      for (const failure of failures) yield* suggest(context, errorMessage(failure));

      expect(context.suggestBugReport).not.toHaveBeenCalled();
    }),
  );

const doesNotSuggestReportsForCancellations = () =>
  runTest(
    Effect.gen(function* () {
      const context = {
        maybeShowInstallChangeWarning: vi.fn(() => false),
        suggestBugReport: vi.fn(),
      };

      yield* suggest(context, errorMessage("This operation was aborted"));
      yield* suggest(context, errorMessage("Request cancelled"));
      yield* suggest(context, fauxAssistantMessage("", { stopReason: "aborted" }));

      expect(context.suggestBugReport).not.toHaveBeenCalled();
    }),
  );

const suggestsReportsForUnexpectedErrors = () =>
  runTest(
    Effect.gen(function* () {
      const context = {
        maybeShowInstallChangeWarning: vi.fn(() => false),
        suggestBugReport: vi.fn(),
      };

      yield* suggest(context, errorMessage("Unexpected internal state"));

      expect(context.suggestBugReport).toHaveBeenCalledOnce();
    }),
  );

const showsTheInstallChangeWarningInsteadOf = () =>
  runTest(
    Effect.gen(function* () {
      const context = {
        maybeShowInstallChangeWarning: vi.fn(() => true),
        suggestBugReport: vi.fn(),
      };

      yield* suggest(context, errorMessage("Cannot find module './worker.js'"));

      expect(context.maybeShowInstallChangeWarning).toHaveBeenCalledOnce();
      expect(context.suggestBugReport).not.toHaveBeenCalled();
    }),
  );

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
