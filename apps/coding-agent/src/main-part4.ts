import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import type argsTypes from "./cli/args.types.ts";
import fileProcessor from "./cli/file-processor.ts";
import initialMessageModule from "./cli/initial-message.ts";
import awaitingModule from "./core/awaiting.ts";
import SessionManager from "./core/session-manager.ts";
import type mainInternalTypes from "./main-internal.types.ts";
import pathsModule from "./utils/paths.ts";

const { awaited, awaiting } = awaitingModule;
const { buildInitialMessage } = initialMessageModule;
const { processFileArguments } = fileProcessor;
const { resolvePath } = pathsModule;

function prepareInitialMessage(
  parsed: argsTypes.Args,
  stdinContent?: string,
): Promise<{
  initialMessage?: string | undefined;
  initialImages?: aiTypes.ImageContent[] | undefined;
}> {
  return Effect.runPromise(
    awaiting(function* () {
      if (parsed.fileArgs.length === 0) {
        return buildInitialMessage({ parsed, stdinContent });
      }

      const { text, images } = yield* awaited(
        processFileArguments(parsed.fileArgs, { autoResizeImages: false }),
      );
      return buildInitialMessage({
        fileImages: images,
        fileText: text,
        parsed,
        stdinContent,
      });
    }),
  );
}

function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
): { type: "local"; path: string } | undefined {
  const path = SessionManager.findById(cwd, sessionId, sessionDir);
  return path !== undefined && path !== "" ? { path, type: "local" } : undefined;
}

function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
): Promise<mainInternalTypes.ResolvedSession> {
  return Effect.runPromise(
    awaiting(function* () {
      if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
        return { path: resolvePath(sessionArg, cwd), type: "path" };
      }

      const exactLocalMatch = findLocalSessionByExactId(sessionArg, cwd, sessionDir);
      if (exactLocalMatch !== undefined) {
        return exactLocalMatch;
      }

      const localSessions = yield* awaited(SessionManager.list(cwd, sessionDir));
      const localMatch = localSessions.find((s) => s.id.startsWith(sessionArg));

      if (localMatch !== undefined) {
        return { path: localMatch.path, type: "local" };
      }

      const allSessions = yield* awaited(SessionManager.listAll(sessionDir));
      const globalMatch =
        allSessions.find((s) => s.id === sessionArg) ??
        allSessions.find((s) => s.id.startsWith(sessionArg));

      if (globalMatch !== undefined) {
        return { cwd: globalMatch.cwd, path: globalMatch.path, type: "global" };
      }

      return { arg: sessionArg, type: "not_found" };
    }),
  );
}

const mainPart4 = {
  findLocalSessionByExactId,
  prepareInitialMessage,
  resolveSessionPath,
};

export default mainPart4;
