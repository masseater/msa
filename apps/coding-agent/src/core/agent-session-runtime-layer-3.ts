import * as Effect from "effect/Effect";

import paths from "../utils/paths.ts";
import AgentSessionRuntimeLayer2 from "./agent-session-runtime-layer-2.ts";
import awaitingModule from "./awaiting.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import sessionCwd from "./session-cwd.ts";
import SessionImportFileNotFoundError from "./session-import-file-not-found-error.ts";
import SessionManager from "./session-manager.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { resolvePath } = paths;
const { constants, copyFileSync, existsSync, mkdirSync } = nodeFs;
const { basename, join, parse, resolve } = platformNode;
const { assertSessionCwdExists } = sessionCwd;

export default abstract class AgentSessionRuntimeLayer3 extends AgentSessionRuntimeLayer2 {
  importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const resolvedPath = resolvePath(inputPath);
        if (!existsSync(resolvedPath)) {
          throw new SessionImportFileNotFoundError(resolvedPath);
        }

        const sessionDir = this.session.sessionManager.getSessionDir();
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }

        let destinationPath = join(sessionDir, basename(resolvedPath));
        const sourceAlreadyStored = resolve(destinationPath) === resolvedPath;
        if (!sourceAlreadyStored) {
          const { name, ext } = parse(destinationPath);
          let suffix = 1;
          while (existsSync(destinationPath)) {
            destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
          }
        }
        const beforeResult = yield* performed(this.emitBeforeSwitch("resume", destinationPath));
        if (beforeResult.cancelled) {
          return beforeResult;
        }

        const previousSessionFile = this.session.sessionFile;
        if (!sourceAlreadyStored) {
          copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
        }

        const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
        assertSessionCwdExists(sessionManager, this.cwd);
        yield* performed(this.teardownCurrent("resume", sessionManager.getSessionFile()));
        this.apply(
          yield* awaited(
            this.createRuntime({
              agentDir: this.services.agentDir,
              cwd: sessionManager.getCwd(),
              sessionManager,
              sessionStartEvent: { previousSessionFile, reason: "resume", type: "session_start" },
            }),
          ),
        );
        yield* performed(this.finishSessionReplacement());
        return { cancelled: false };
      }, this),
    );
  }
}
