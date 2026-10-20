import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import ExtensionEditorComponent from "./components/extension-editor.ts";
import type extensionEditorTypes from "./components/extension-editor.types.ts";
import ExtensionSelectorComponent from "./components/extension-selector.ts";
import type extensionSelectorTypes from "./components/extension-selector.types.ts";

const { awaited, awaiting } = awaitingModule;

const DISCLAIMER =
  "The report is written to a zip archive in the current directory. It includes your msa version, operating system, the current model and provider configuration (without API keys), loaded extensions, settings, and provider error diagnostics from this session.";

const TRANSCRIPT_NOTE =
  "The transcript contains your messages, model output, tool calls and their results, including file contents and command output read during this session.";

function promptForOptions(
  context: bugReportInternalTypes.BugReportContext,
  initialHint: string | undefined,
): Effect.Effect<bugReportInternalTypes.BugReportOptions | undefined> {
  return awaiting(function* () {
    const hint = yield* awaited(
      input(context, "Report a bug", `${DISCLAIMER}\n\nWhat went wrong? (optional)`, initialHint),
    );
    if (hint === null) return undefined;
    const transcript = yield* awaited(
      choose(
        context,
        "Include the session transcript?",
        ["Yes, include the transcript", "No"],
        TRANSCRIPT_NOTE,
      ),
    );
    if (transcript === undefined || transcript === "") return undefined;
    const includeSession = transcript !== "No";
    let includeSummary = false;
    if (!includeSession) {
      const model = context.session.model;
      const summary = yield* awaited(
        choose(
          context,
          `Attach a summary written by ${model?.name ?? "the current model"} instead?`,
          ["Yes, generate a summary", "No"],
          `The transcript is sent to ${model?.provider ?? "your provider"} with your credentials and tokens. Only the generated summary is attached; the transcript stays on your machine.`,
        ),
      );
      if (summary === undefined || summary === "") return undefined;
      includeSummary = summary !== "No";
    }
    const description = hint.trim();
    const delivery = yield* awaited(
      choose(
        context,
        "Bug report",
        ["Export as Zip", "Cancel"],
        `Description: ${description || "none"}\nTranscript: ${includeSession ? "included" : "not included"}\nSummary: ${includeSummary ? `written by ${context.session.model?.name ?? "the current model"}` : "none"}\n\nExport writes a zip archive to the current directory.`,
      ),
    );
    if (delivery === undefined || delivery === "" || delivery === "Cancel") return undefined;
    return {
      hint: description || undefined,
      includeSession,
      includeSummary,
    };
  });
}

function input(
  context: bugReportInternalTypes.BugReportContext,
  title: string,
  description: string,
  initialValue?: string,
): Promise<string | null> {
  return Effect.runPromise(
    Effect.callback<string | null>((resume) => {
      let component: extensionEditorTypes.ExtensionEditorComponent;
      const finish = (value: string | null) => {
        restoreEditor(context, component);
        resume(Effect.succeed(value));
      };
      component = new ExtensionEditorComponent(
        context.ui,
        context.keybindings,
        title,
        initialValue,
        (value) => finish(value),
        () => finish(null),
        { description },
        context.session.settingsManager.terminal.getExternalEditorCommand(),
      );
      showOverlay(context, component);
    }),
  );
}

function choose(
  context: bugReportInternalTypes.BugReportContext,
  title: string,
  options: string[],
  description?: string,
): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.callback<string | undefined>((resume) => {
      let component: extensionSelectorTypes.ExtensionSelectorComponent;
      const finish = (value?: string) => {
        restoreEditor(context, component);
        resume(Effect.succeed(value));
      };
      component = new ExtensionSelectorComponent(title, options, finish, () => finish(), {
        description,
        tui: context.ui,
      });
      showOverlay(context, component);
    }),
  );
}

function showOverlay(
  context: bugReportInternalTypes.BugReportContext,
  component: bugReportInternalTypes.Overlay,
): void {
  context.editorSlot.show(component);
}

function restoreEditor(
  context: bugReportInternalTypes.BugReportContext,
  component: bugReportInternalTypes.Overlay,
): void {
  component.dispose?.();
  context.editorSlot.restoreEditor();
}

const bugReportPart1 = {
  promptForOptions,
  restoreEditor,
  showOverlay,
};

export default bugReportPart1;
