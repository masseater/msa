import * as Effect from "effect/Effect";

import paths from "../../utils/paths.ts";
import type AgentSessionRuntime from "../agent-session-runtime.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import platformModule from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";
import sessionCwd from "../session-cwd.ts";
import SessionImportFileNotFoundError from "../session-import-file-not-found-error.ts";
import SessionManager from "../session-manager.ts";

const { awaitingWith, performed } = awaitingModule;
const { assertSessionCwdExists } = sessionCwd;
const { existsSync, constants, copyFileSync, mkdirSync } = nodeFs;
const { resolvePath } = paths;
const { basename, join, parse, resolve } = platformModule;

const importDestination = (
  resolvedPath: string,
  sessionDir: string,
): { destinationPath: string; sourceAlreadyStored: boolean } => {
  let destinationPath = join(sessionDir, basename(resolvedPath));
  const sourceAlreadyStored = resolve(destinationPath) === resolvedPath;
  if (!sourceAlreadyStored) {
    const { name, ext } = parse(destinationPath);
    let suffix = 1;
    while (existsSync(destinationPath)) {
      destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
    }
  }
  return { destinationPath, sourceAlreadyStored };
};

export default class SessionTransitions {
  private readonly runtime: AgentSessionRuntime;

  constructor(runtime: AgentSessionRuntime) {
    this.runtime = runtime;
  }

  switchSession(
    sessionPath: string,
    options?: {
      cwdOverride?: string | undefined;
      withSession?: ((ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>) | undefined;
      projectTrustContextFactory?:
        | ((cwd: string) => extensionsTypes.ProjectTrustContext)
        | undefined;
    },
  ): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { replacement } = this.runtime;
        const beforeResult = yield* performed(replacement.emitBeforeSwitch("resume", sessionPath));
        if (beforeResult.cancelled) return beforeResult;

        const previousSessionFile = this.runtime.session.sessionFile;
        const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
        assertSessionCwdExists(sessionManager, this.runtime.cwd);
        yield* performed(
          replacement.replace("resume", sessionManager, previousSessionFile, {
            cwd: sessionManager.getCwd(),
            projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
            withSession: options?.withSession,
          }),
        );
        return { cancelled: false };
      }, this),
    );
  }

  newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
    withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>;
  }): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { replacement, session, cwd } = this.runtime;
        const beforeResult = yield* performed(replacement.emitBeforeSwitch("new"));
        if (beforeResult.cancelled) return beforeResult;

        const previousSessionFile = session.sessionFile;
        const sessionManager = session.sessionManager.isPersisted()
          ? SessionManager.create(cwd, session.sessionManager.getSessionDir())
          : SessionManager.inMemory(cwd);
        if (options?.parentSession !== undefined && options?.parentSession !== "") {
          sessionManager.newSession({ parentSession: options.parentSession });
        }
        yield* performed(
          replacement.replace("new", sessionManager, previousSessionFile, {
            setup: options?.setup,
            withSession: options?.withSession,
          }),
        );
        return { cancelled: false };
      }, this),
    );
  }

  importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const resolvedPath = resolvePath(inputPath);
        if (!existsSync(resolvedPath)) {
          throw new SessionImportFileNotFoundError(resolvedPath);
        }
        const sessionDir = this.runtime.session.sessionManager.getSessionDir();
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }
        const { destinationPath, sourceAlreadyStored } = importDestination(
          resolvedPath,
          sessionDir,
        );
        const { replacement } = this.runtime;
        const beforeResult = yield* performed(
          replacement.emitBeforeSwitch("resume", destinationPath),
        );
        if (beforeResult.cancelled) return beforeResult;

        const previousSessionFile = this.runtime.session.sessionFile;
        if (!sourceAlreadyStored) {
          copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
        }
        const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
        assertSessionCwdExists(sessionManager, this.runtime.cwd);
        yield* performed(
          replacement.replace("resume", sessionManager, previousSessionFile, {
            cwd: sessionManager.getCwd(),
          }),
        );
        return { cancelled: false };
      }, this),
    );
  }
}
