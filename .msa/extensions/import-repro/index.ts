import * as NodeServices from "@effect/platform-node/NodeServices";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Cause, Effect, FileSystem, ManagedRuntime, Path } from "effect";

import cwdRewrite from "./cwd-rewrite.ts";
import gist from "./gist.ts";
import session from "./session.ts";
import type sessionTypes from "./session.types.ts";

const { ImportReproError, decodeExportedHtml, parseRef, parseSessionJsonl } = session;
const { fetchGistSession, findIssueGistId } = gist;
const { getPlatformContinuationNotice, rewriteSessionCwd } = cwdRewrite;

const runtime = ManagedRuntime.make(NodeServices.layer);

interface LoadedSession {
  readonly decoded: sessionTypes.DecodedSession;
  readonly sourceName: string;
}

const toImportReproError = (error: { readonly message: string }): sessionTypes.ImportReproError =>
  ImportReproError.make({ message: error.message });

const loadSession = (
  parsedRef: sessionTypes.SessionRef,
): Effect.Effect<LoadedSession, sessionTypes.ImportReproError, FileSystem.FileSystem | Path.Path> =>
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
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(parsedRef.path).pipe(Effect.orDie))) {
      return yield* ImportReproError.make({ message: `session file not found: ${parsedRef.path}` });
    }
    const raw = yield* fs.readFileString(parsedRef.path).pipe(Effect.mapError(toImportReproError));
    const decoded = parsedRef.path.endsWith(".html")
      ? decodeExportedHtml(raw)
      : parseSessionJsonl(raw);
    return { decoded, sourceName: path.basename(parsedRef.path).replace(/\.html$/u, ".jsonl") };
  });

const confirmOverwrite = (
  ctx: codingAgentTypes.ExtensionCommandContext,
  destination: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(destination).pipe(Effect.orDie))) return true;
    return yield* Effect.promise(() =>
      ctx.ui.confirm(
        "Session already imported",
        `Overwrite ${destination}? Local changes to that session will be lost.`,
      ),
    );
  });

const switchToImported = (
  ctx: codingAgentTypes.ExtensionCommandContext,
  destination: string,
  decoded: sessionTypes.DecodedSession,
  targetCwd: string,
): Effect.Effect<void> => {
  const platformNotice = getPlatformContinuationNotice(decoded.header.cwd);
  return Effect.promise(() =>
    ctx.switchSession(destination, {
      withSession: (nextCtx) => {
        if (platformNotice === undefined || platformNotice === "") return Promise.resolve();
        return nextCtx.sendMessage(
          {
            content: platformNotice,
            customType: "import-repro",
            details: { sourceCwd: decoded.header.cwd, targetCwd },
            display: true,
          },
          { triggerTurn: false },
        );
      },
    }),
  );
};

const importRepro = (
  ref: string,
  ctx: codingAgentTypes.ExtensionCommandContext,
): Effect.Effect<void, sessionTypes.ImportReproError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const targetCwd = ctx.sessionManager.getCwd();
    const sessionDir = ctx.sessionManager.getSessionDir();
    const parsedRef = parseRef(ref, targetCwd);

    ctx.ui.notify(`Importing repro session from ${ref}...`, "info");

    const { decoded, sourceName } = yield* loadSession(parsedRef);
    const rewritten = rewriteSessionCwd(decoded.jsonl, decoded.header.cwd, targetCwd);
    const destination = path.join(sessionDir, sourceName);
    if (!(yield* confirmOverwrite(ctx, destination))) {
      ctx.ui.notify("Import cancelled", "warning");
      return;
    }
    yield* fs.writeFileString(destination, rewritten).pipe(Effect.mapError(toImportReproError));

    ctx.ui.notify(
      `Imported session ${decoded.header.id} (cwd ${decoded.header.cwd} -> ${targetCwd})`,
      "info",
    );
    yield* switchToImported(ctx, destination, decoded, targetCwd);
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerCommand("ir", {
    description:
      "Import a CI issue-analysis session from a gist ID, share URL, or issue URL and switch to it",
    handler: (args: string, ctx: codingAgentTypes.ExtensionCommandContext) => {
      const ref = args.trim();
      if (ref === "") {
        ctx.ui.notify("Usage: /ir <gist-id | gist-url | pi.dev/session URL | issue URL>", "error");
        return Promise.resolve();
      }

      return runtime.runPromise(
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
