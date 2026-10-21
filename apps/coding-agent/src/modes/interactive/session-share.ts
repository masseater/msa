import tui from "@msa/tui";
import { Effect } from "effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import BorderedLoader from "./components/bordered-loader.ts";
import githubGist from "./github-gist.ts";
import sessionHtmlExport from "./session-html-export.ts";
import type sessionShareTypes from "./session-share.types.ts";
import themeModule from "./theme/theme.ts";

const { performed, awaiting } = awaitingModule;
const { theme } = themeModule;

type Context = sessionShareTypes.SessionShareContext;

function restoreEditor(loader: BorderedLoader, context: Context): void {
  loader.dispose();
  context.editorSlot.restoreEditor();
}

function reportGist(result: sessionShareTypes.GistResult, context: Context): void {
  if (result.code !== 0) {
    context.showError(`Failed to create gist: ${result.stderr?.trim() || "Unknown error"}`);
    return;
  }
  const gistUrl = result.stdout?.trim();
  const gistId = gistUrl?.split("/").pop();
  if (gistId === undefined || gistId === "") {
    context.showError("Failed to parse gist ID from gh output");
    return;
  }
  const previewUrl = config.getShareViewerUrl(gistId);
  context.showStatus(
    `Share URL: ${tui.hyperlink(previewUrl, previewUrl)}\nGist: ${tui.hyperlink(gistUrl, gistUrl)}`,
  );
}

function shareViaGist(htmlFile: string, context: Context): Effect.Effect<void> {
  return awaiting(function* () {
    const loader = new BorderedLoader(context.ui, theme, "Creating gist...");
    context.editorSlot.show(loader);
    const gist = githubGist.createSecretGist(htmlFile);
    loader.onAbort = () => {
      gist.cancel();
      restoreEditor(loader, context);
      context.showStatus("Share cancelled");
    };
    try {
      const result = yield* performed(gist.result);
      if (loader.signal.aborted) return;
      restoreEditor(loader, context);
      reportGist(result, context);
    } catch (error: unknown) {
      if (!loader.signal.aborted) {
        restoreEditor(loader, context);
        const reason = error instanceof Error ? error.message : "Unknown error";
        context.showError(`Failed to create gist: ${reason}`);
      }
    }
  });
}

function shareSession(context: Context): Promise<void> {
  const problem = githubGist.githubCliProblem();
  if (problem !== undefined) {
    context.showError(problem);
    return Promise.resolve();
  }
  return Effect.runPromise(
    sessionHtmlExport.withExportedHtml(context.session, context.showError, (htmlFile) =>
      shareViaGist(htmlFile, context),
    ),
  );
}

const sessionShare = {
  shareSession,
};

export default sessionShare;
