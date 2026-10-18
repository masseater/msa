import type { Container, TUI } from "@msa/tui";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { AgentSession } from "../../core/agent-session.ts";
import { awaited, awaiting, performed } from "../../core/awaiting.ts";
import {
  BUG_REPORT_CUSTOM_ENTRY_TYPE,
  type BugReportBundle,
  type BugReportSessionEntryData,
  bugReportArchiveFileName,
  collectBugReportDiagnostics,
  collectBugReportMetadata,
  writeBugReportArchive,
} from "../../core/bug-report.ts";
import { clearCrashLog, readCrashLog } from "../../core/crash-log.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { serializeSessionBranch } from "../../core/session-export.ts";
import { join } from "../path.ts";
import { BorderedLoader } from "./components/bordered-loader.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import type { EditorSlot } from "./editor-slot.ts";
import { createShareTrailingEntries } from "./session-share.ts";
import { theme } from "./theme/theme.ts";

interface BugReportContext {
  session: AgentSession;
  ui: TUI;
  editorSlot: EditorSlot;
  keybindings: KeybindingsManager;
  showStatus: (message: string) => void;
  showError: (message: string) => void;
}

interface BugReportOptions {
  hint?: string | undefined;
  includeSession: boolean;
  includeSummary: boolean;
}

type Overlay = Container & { dispose?: () => void };

const DISCLAIMER =
  "The report is written to a zip archive in the current directory. It includes your msa version, operating system, the current model and provider configuration (without API keys), loaded extensions, settings, and provider error diagnostics from this session.";
const TRANSCRIPT_NOTE =
  "The transcript contains your messages, model output, tool calls and their results, including file contents and command output read during this session.";

export const reportBug: {
  (initialHint?: string): (context: BugReportContext) => Promise<void>;
  (context: BugReportContext, initialHint?: string): Promise<void>;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  (context: BugReportContext, initialHint?: string): Promise<void> =>
    Effect.runPromise(
      awaiting(function* () {
        const options = yield* performed(promptForOptions(context, initialHint));
        if (options === undefined) {
          context.showStatus("Bug report cancelled");
          return;
        }

        let summary: string | undefined;
        if (options.includeSummary) {
          const loader = showLoader(
            context,
            `Writing summary with ${context.session.model?.name ?? "the current model"}...`,
          );
          try {
            summary = yield* awaited(
              context.session.summarizeForBugReport({
                hint: options.hint,
                signal: loader.signal,
              }),
            );
          } catch (error: unknown) {
            restoreEditor(context, loader);
            if (loader.signal.aborted) context.showStatus("Bug report cancelled");
            else context.showError(`Failed to write bug report summary: ${errorMessage(error)}`);
            return;
          }
          restoreEditor(context, loader);
          if (loader.signal.aborted) {
            context.showStatus("Bug report cancelled");
            return;
          }
        }

        let bundle: BugReportBundle;
        try {
          bundle = buildBundle(context.session, options, summary);
        } catch (error: unknown) {
          context.showError(`Failed to build bug report: ${errorMessage(error)}`);
          return;
        }

        yield* performed(exportZip(context, bundle));
      }),
    ),
);

function promptForOptions(
  context: BugReportContext,
  initialHint: string | undefined,
): Effect.Effect<BugReportOptions | undefined> {
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

function buildBundle(
  session: AgentSession,
  options: BugReportOptions,
  summary: string | undefined,
): BugReportBundle {
  const extensions = session.resourceLoader.getExtensions();
  return {
    metadata: collectBugReportMetadata({
      hint: options.hint,
      sessionId: session.sessionId,
      cwd: session.sessionManager.getCwd(),
      includeSession: options.includeSession,
      includeSummary: summary !== undefined,
      messageCount: session.messages.length,
      model: session.model,
      modelRuntime: session.modelRuntime,
      thinkingLevel: session.thinkingLevel,
      extensions: extensions.extensions,
      extensionErrors: extensions.errors,
      globalSettings: session.settingsManager.getGlobalSettings(),
      projectSettings: session.settingsManager.getProjectSettings(),
    }),
    diagnostics: collectBugReportDiagnostics(session.sessionManager, readCrashLog()),
    summary,
    sessionJsonl: options.includeSession
      ? serializeSessionBranch(session.sessionManager, (parentId, timestamp) =>
          createShareTrailingEntries(session, parentId, timestamp),
        )
      : undefined,
  };
}

function exportZip(context: BugReportContext, bundle: BugReportBundle): Effect.Effect<void> {
  return awaiting(function* () {
    const archivePath = join(process.cwd(), bugReportArchiveFileName(bundle.metadata.id));
    try {
      yield* awaited(writeBugReportArchive(bundle, archivePath));
    } catch (error: unknown) {
      context.showError(`Failed to write bug report: ${errorMessage(error)}`);
      return;
    }
    recordInSession(context.session, bundle, { delivery: "zip", path: archivePath });
    context.showStatus(`Bug report exported to: ${archivePath}\nReport ID: ${bundle.metadata.id}`);
  });
}

function recordInSession(
  session: AgentSession,
  bundle: BugReportBundle,
  delivery: Pick<BugReportSessionEntryData, "delivery" | "path">,
): void {
  session.sessionManager.appendCustomEntry(BUG_REPORT_CUSTOM_ENTRY_TYPE, {
    id: bundle.metadata.id,
    createdAt: bundle.metadata.createdAt,
    hint: bundle.metadata.hint,
    sessionIncluded: bundle.metadata.session.included,
    summaryIncluded: bundle.metadata.session.summaryIncluded,
    ...delivery,
  } satisfies BugReportSessionEntryData);
  if (bundle.diagnostics.crashes.length > 0) clearCrashLog();
}

function input(
  context: BugReportContext,
  title: string,
  description: string,
  initialValue?: string,
): Promise<string | null> {
  return Effect.runPromise(
    Effect.callback<string | null>((resume) => {
      let component: ExtensionEditorComponent;
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
        context.session.settingsManager.getExternalEditorCommand(),
      );
      showOverlay(context, component);
    }),
  );
}

function choose(
  context: BugReportContext,
  title: string,
  options: string[],
  description?: string,
): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.callback<string | undefined>((resume) => {
      let component: ExtensionSelectorComponent;
      const finish = (value?: string) => {
        restoreEditor(context, component);
        resume(Effect.succeed(value));
      };
      component = new ExtensionSelectorComponent(title, options, finish, () => finish(), {
        tui: context.ui,
        description,
      });
      showOverlay(context, component);
    }),
  );
}

function showLoader(context: BugReportContext, message: string): BorderedLoader {
  const loader = new BorderedLoader(context.ui, theme, message);
  showOverlay(context, loader);
  return loader;
}

function showOverlay(context: BugReportContext, component: Overlay): void {
  context.editorSlot.show(component);
}

function restoreEditor(context: BugReportContext, component: Overlay): void {
  component.dispose?.();
  context.editorSlot.restoreEditor();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
