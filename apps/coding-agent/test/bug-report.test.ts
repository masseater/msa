import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import bugReportModule from "../src/core/bug-report.ts";
import bugReport from "../src/modes/interactive/bug-report.ts";
import components from "../src/modes/interactive/components/index.ts";
import editorSlotUi from "./editor-slot-ui.ts";

const { ExtensionEditorComponent, ExtensionSelectorComponent } = components;

const { reportBug } = bugReport;
const { redactJsonValue, redactUrl } = bugReportModule;

const { stripTerminalSequences } = tui;

const { awaited, runTest } = testing;

const { createEditorSlotUi, prepareTheme } = editorSlotUi;

beforeAll(prepareTheme);

const nextSelector = Effect.fn("nextSelector")(function* (container: tuiTypes.Container) {
  yield* awaited(
    vi.waitFor(() => expect(container.children[0]).toBeInstanceOf(ExtensionSelectorComponent)),
  );
  const selector = container.children[0];
  if (!(selector instanceof ExtensionSelectorComponent)) throw new Error("Missing selector");
  return selector;
});

const declineNext = Effect.fn("declineNext")(function* (
  container: tuiTypes.Container,
  prompt: string,
) {
  const selector = yield* nextSelector(container);
  expect(selector.render(120).join("\n")).toContain(prompt);
  selector.handleInput("j");
  selector.handleInput("\r");
});

const pasteDescription = (container: tuiTypes.Container) => {
  const descriptionEditor = container.children[0];
  expect(descriptionEditor).toBeInstanceOf(ExtensionEditorComponent);
  if (!(descriptionEditor instanceof ExtensionEditorComponent))
    throw new Error("Missing description editor");
  descriptionEditor.handleInput(
    "\x1b[200~Request failed\r\n  ↳ msa exiting...\r\nstack trace\x1b[201~",
  );
  descriptionEditor.handleInput("\r");
};

const startReport = () => {
  const { container, editor, editorSlot, keybindings, restoreKeybindings, ui } =
    createEditorSlotUi();
  const session = {
    model: undefined,
    settingsManager: { getExternalEditorCommand: () => "nano" },
  } as unknown as agentSessionTypes.AgentSession;
  const showStatus = vi.fn();
  const report = reportBug({
    editorSlot,
    keybindings,
    session,
    showError: vi.fn(),
    showStatus,
    ui,
  });
  return { container, editor, report, restoreKeybindings, showStatus };
};

const preservesLineBreaksInPastedDescriptions = Effect.gen(function* () {
  const { container, editor, report, restoreKeybindings, showStatus } = startReport();
  yield* Effect.gen(function* () {
    pasteDescription(container);
    expect(container.children[0]).toBe(editor);
    yield* declineNext(container, "Include the session transcript?");
    expect(container.children[0]).toBe(editor);
    yield* declineNext(container, "Attach a summary written by");
    expect(container.children[0]).toBe(editor);
    const delivery = yield* nextSelector(container);
    const lines = delivery.render(120).map(stripTerminalSequences);
    expect(lines.some((line) => line.includes("Description: Request failed"))).toBe(true);
    expect(lines.some((line) => line.includes("↳ msa exiting..."))).toBe(true);
    expect(lines.some((line) => line.includes("stack trace"))).toBe(true);
    delivery.handleInput("j");
    delivery.handleInput("\r");
    yield* awaited(report);
    expect(showStatus).toHaveBeenCalledWith("Bug report cancelled");
  }).pipe(Effect.ensuring(Effect.sync(restoreKeybindings)));
});

describe("bug report prompt", () => {
  it("preserves line breaks in pasted descriptions", () =>
    runTest(preservesLineBreaksInPastedDescriptions));
});

const removesUrlCredentialsAndSecretQueryParameters = () => {
  expect(redactUrl("https://user:pass@proxy.example.com:8080/")).toBe(
    "https://proxy.example.com:8080/",
  );
  expect(redactUrl("git:https://pat@github.com/org/repo")).toBe("git:https://github.com/org/repo");
  expect(redactUrl("https://api.example/v1?api-key=abc&model=x")).toBe(
    "https://api.example/v1?api-key=%3Credacted%3E&model=x",
  );
};

const redactsNestedSecretValuesWithoutHidingToken = () => {
  expect(
    redactJsonValue({
      apiKey: "sk-123",
      baseUrl: "https://me:secret@example.com/",
      compaction: { keepRecentTokens: 20_000, reserveTokens: 16_384 },
      headers: { Authorization: "Bearer x", "X-Trace": "1" },
    }),
  ).toEqual({
    apiKey: "<redacted>",
    baseUrl: "https://example.com/",
    compaction: { keepRecentTokens: 20_000, reserveTokens: 16_384 },
    headers: { Authorization: "<redacted>", "X-Trace": "1" },
  });
};

describe("bug report redaction", () => {
  it(
    "removes URL credentials and secret query parameters",
    removesUrlCredentialsAndSecretQueryParameters,
  );

  it(
    "redacts nested secret values without hiding token counts",
    redactsNestedSecretValuesWithoutHidingToken,
  );
});
