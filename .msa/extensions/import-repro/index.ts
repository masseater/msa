import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@msa/coding-agent";
import { Cause, Effect } from "effect";

import { getPlatformContinuationNotice, rewriteSessionCwd } from "./cwd-rewrite.ts";
import { fetchGistSession, findIssueGistId } from "./gist.ts";
import {
  decodeExportedHtml,
  type DecodedSession,
  ImportReproError,
  parseRef,
  parseSessionJsonl,
  type SessionRef,
} from "./session.ts";

interface LoadedSession {
  readonly decoded: DecodedSession;
  readonly sourceName: string;
}

const loadSession = (parsedRef: SessionRef): Effect.Effect<LoadedSession, ImportReproError> =>
  Effect.gen(function* () {
    if (parsedRef.type === "gist") {
      const decoded = yield* fetchGistSession(parsedRef.id);
      return { decoded, sourceName: `${parsedRef.id}.jsonl` };
    }
    if (parsedRef.type === "issue") {
      const gistId = yield* findIssueGistId(parsedRef);
      const decoded = yield* fetchGistSession(gistId);
      return { decoded, sourceName: `${gistId}.jsonl` };
    }
    if (!existsSync(parsedRef.path)) {
      return yield* new ImportReproError({ message: `session file not found: ${parsedRef.path}` });
    }
    const raw = readFileSync(parsedRef.path, "utf8");
    const decoded = parsedRef.path.endsWith(".html")
      ? decodeExportedHtml(raw)
      : parseSessionJsonl(raw);
    return { decoded, sourceName: basename(parsedRef.path).replace(/\.html$/u, ".jsonl") };
  });

const confirmOverwrite = (
  ctx: ExtensionCommandContext,
  destination: string,
): Effect.Effect<boolean> => {
  if (!existsSync(destination)) return Effect.succeed(true);
  return Effect.promise(() =>
    ctx.ui.confirm(
      "Session already imported",
      `Overwrite ${destination}? Local changes to that session will be lost.`,
    ),
  );
};

const switchToImported = (
  ctx: ExtensionCommandContext,
  destination: string,
  decoded: DecodedSession,
  targetCwd: string,
): Effect.Effect<void> => {
  const platformNotice = getPlatformContinuationNotice(decoded.header.cwd);
  return Effect.promise(() =>
    ctx.switchSession(destination, {
      withSession: (nextCtx) => {
        if (platformNotice === undefined || platformNotice === "") return Promise.resolve();
        return nextCtx.sendMessage(
          {
            customType: "import-repro",
            content: platformNotice,
            display: true,
            details: { sourceCwd: decoded.header.cwd, targetCwd },
          },
          { triggerTurn: false },
        );
      },
    }),
  );
};

const importRepro = (
  ref: string,
  ctx: ExtensionCommandContext,
): Effect.Effect<void, ImportReproError> =>
  Effect.gen(function* () {
    const targetCwd = ctx.sessionManager.getCwd();
    const sessionDir = ctx.sessionManager.getSessionDir();
    const parsedRef = parseRef(ref, targetCwd);

    ctx.ui.notify(`Importing repro session from ${ref}...`, "info");

    const { decoded, sourceName } = yield* loadSession(parsedRef);
    const rewritten = rewriteSessionCwd(decoded.jsonl, decoded.header.cwd, targetCwd);
    const destination = join(sessionDir, sourceName);
    if (!(yield* confirmOverwrite(ctx, destination))) {
      ctx.ui.notify("Import cancelled", "warning");
      return;
    }
    writeFileSync(destination, rewritten);

    ctx.ui.notify(
      `Imported session ${decoded.header.id} (cwd ${decoded.header.cwd} -> ${targetCwd})`,
      "info",
    );
    yield* switchToImported(ctx, destination, decoded, targetCwd);
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default function (msa: ExtensionAPI) {
  msa.registerCommand("ir", {
    description:
      "Import a CI issue-analysis session from a gist ID, share URL, or issue URL and switch to it",
    handler: (args: string, ctx: ExtensionCommandContext) => {
      const ref = args.trim();
      if (ref === "") {
        ctx.ui.notify("Usage: /ir <gist-id | gist-url | pi.dev/session URL | issue URL>", "error");
        return Promise.resolve();
      }

      return Effect.runPromise(
        importRepro(ref, ctx).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              ctx.ui.notify(`ir: ${errorMessage(Cause.squash(cause))}`, "error");
            }),
          ),
        ),
      );
    },
  });
}
