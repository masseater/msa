import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import platformModule from "../../core/platform/index.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import os from "../../core/platform/node/os.ts";
import themeModule from "./theme/theme.ts";

const { awaited, awaiting, performed } = awaitingModule;

function withExportedHtml(
  session: agentSessionTypes.AgentSession,
  onError: (message: string) => void,
  use: (htmlFile: string) => Effect.Effect<void>,
): Effect.Effect<void> {
  return awaiting(function* () {
    const tempDir = nodeFs.mkdtempSync(platformModule.join(os.tmpdir(), "msa-share-"));
    const htmlFile = platformModule.join(tempDir, "session.html");
    try {
      try {
        yield* awaited(
          session.context.exports.exportToHtml(htmlFile, { themeName: themeModule.theme.name }),
        );
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        onError(`Failed to export session: ${reason}`);
        return;
      }
      yield* performed(use(htmlFile));
    } finally {
      try {
        nodeFs.rmSync(tempDir, { force: true, recursive: true });
      } catch {}
    }
  });
}

const sessionHtmlExport = {
  withExportedHtml,
};

export default sessionHtmlExport;
