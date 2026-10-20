import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";

import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { getShareViewerUrl } from "../../config.ts";
import type { AgentSession } from "../../core/agent-session.ts";
import { awaited, awaiting, performed } from "../../core/awaiting.ts";
import { join, randomUuid } from "../path.ts";
import { BorderedLoader } from "./components/bordered-loader.ts";
import type { EditorSlot } from "./editor-slot.ts";
import { theme } from "./theme/theme.ts";

const { hyperlink } = tui;

interface SessionShareContext {
  session: AgentSession;
  ui: tuiTypes.TUI;
  editorSlot: EditorSlot;
  showStatus: (message: string) => void;
  showError: (message: string) => void;
}

export const createShareTrailingEntries: {
  (parentId: string | null, timestamp: string): (session: AgentSession) => object[];
  (session: AgentSession, parentId: string | null, timestamp: string): object[];
} = dual(3, (session: AgentSession, parentId: string | null, timestamp: string): object[] => [
  {
    customType: "msa.share",
    data: {
      systemPrompt: session.state.systemPrompt,
      tools: session.state.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
    id: randomUuid().slice(0, 8),
    parentId,
    timestamp,
    type: "custom",
  },
]);

export function shareSession(context: SessionShareContext): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const tempDir = fs.mkdtempSync(join(os.tmpdir(), "msa-share-"));
      const htmlFile = join(tempDir, "session.html");

      try {
        try {
          const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
          if (authResult.status !== 0) {
            context.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
            return;
          }
        } catch {
          context.showError(
            "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
          );
          return;
        }

        try {
          yield* awaited(context.session.exportToHtml(htmlFile, { themeName: theme.name }));
        } catch (error: unknown) {
          context.showError(
            `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          return;
        }
        yield* performed(shareViaGist(htmlFile, context));
      } finally {
        try {
          fs.rmSync(tempDir, { force: true, recursive: true });
        } catch {}
      }
    }),
  );
}

function shareViaGist(tmpFile: string, context: SessionShareContext): Effect.Effect<void> {
  return awaiting(function* () {
    const loader = new BorderedLoader(context.ui, theme, "Creating gist...");
    context.editorSlot.show(loader);

    let proc: ReturnType<typeof spawn> | null = null;
    loader.onAbort = () => {
      proc?.kill();
      restoreEditor(loader, context);
      context.showStatus("Share cancelled");
    };

    try {
      const result = yield* awaited(
        new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
          proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
          let stdout = "";
          let stderr = "";
          proc.stdout?.on("data", (data) => {
            stdout += data.toString();
          });
          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });
          proc.on("close", (code) => resolve({ code, stderr, stdout }));
        }),
      );

      if (loader.signal.aborted) return;
      restoreEditor(loader, context);

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

      const previewUrl = getShareViewerUrl(gistId);
      context.showStatus(
        `Share URL: ${hyperlink(previewUrl, previewUrl)}\nGist: ${hyperlink(gistUrl, gistUrl)}`,
      );
    } catch (error: unknown) {
      if (!loader.signal.aborted) {
        restoreEditor(loader, context);
        context.showError(
          `Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  });
}

function restoreEditor(loader: BorderedLoader, context: SessionShareContext): void {
  loader.dispose();
  context.editorSlot.restoreEditor();
}
