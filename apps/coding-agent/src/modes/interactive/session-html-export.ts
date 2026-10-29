import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import platformModule from "../../core/platform/index.ts";
import themeModule from "./theme/theme.ts";

const { awaited, awaiting, performed } = awaitingModule;

function withExportedHtml(
  session: agentSessionTypes.AgentSession,
  onError: (message: string) => void,
  use: (htmlFile: string) => Effect.Effect<void>,
): Effect.Effect<void> {
  return awaiting(function* () {
    const tempDir = yield* awaited(platformModule.files.makeTempDirectory("msa-share-"));
    const htmlFile = platformModule.join(tempDir, "session.html");
    try {
      try {
        yield* awaited(
          session.context.exports.exportToHtml(htmlFile, {
            themeName: themeModule.theme.name,
            viewedInSrcdoc: true,
          }),
        );
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        onError(`Failed to export session: ${reason}`);
        return;
      }
      yield* performed(use(htmlFile));
    } finally {
      yield* awaited(
        platformModule.files
          .remove({ force: true, path: tempDir, recursive: true })
          .catch(() => undefined),
      );
    }
  });
}

const sessionHtmlExport = {
  withExportedHtml,
};

export default sessionHtmlExport;
