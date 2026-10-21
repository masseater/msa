import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import sessionLog from "../platform/node/session-log.ts";
import type sessionManagerInternalTypes from "../session-manager-internal.types.ts";
import type SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFiles from "./session-files.ts";
import sessionFormat from "./session-format.ts";

const { appendSessionLine, writeSessionLines } = sessionLog;
const { getDefaultSessionDirPath } = sessionFiles;
const { CURRENT_SESSION_VERSION, assertValidSessionId, migrateToCurrentVersion, createSessionId } =
  sessionFormat;
const { join, nowIso } = platform;
const { normalizePath, resolvePath } = paths;
const { APP_NAME } = config;

export default class SessionStorage {
  private readonly manager: SessionManager;

  constructor(manager: SessionManager) {
    this.manager = manager;
  }

  sessionId: string = "";

  sessionFile!: string | undefined;

  sessionDir!: string;

  persist!: boolean;

  flushed: boolean = false;

  private writeEntries(path: string, flag: "w" | "wx"): void {
    writeSessionLines({
      flag,
      lines: this.manager.tree.fileEntries.map((entry) => `${JSON.stringify(entry)}\n`),
      path,
    });
  }

  rewriteFile(): void {
    if (!this.persist || this.sessionFile === undefined || this.sessionFile === "") return;
    this.writeEntries(this.sessionFile, "w");
  }

  isPersisted(): boolean {
    return this.persist;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  usesDefaultSessionDir(): boolean {
    return this.sessionDir === getDefaultSessionDirPath(this.manager.cwd);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  persistInternal(entry: sessionManagerTypes.SessionEntry): void {
    if (!this.persist || this.sessionFile === undefined || this.sessionFile === "") return;

    if (this.flushed) {
      appendSessionLine(
        this.sessionFile,
        `${JSON.stringify(entry)}
`,
      );
    } else {
      if (!this.manager.tree.hasConversation()) return;
      this.writeEntries(this.sessionFile, "wx");
      this.flushed = true;
    }
  }

  newSession(options?: sessionManagerTypes.NewSessionOptions): string | undefined {
    if (options?.id !== undefined) {
      assertValidSessionId(options.id);
    }
    this.sessionId = options?.id ?? createSessionId();
    const timestamp = nowIso();
    const header: sessionManagerTypes.SessionHeader = {
      cwd: this.manager.cwd,
      id: this.sessionId,
      parentSession: options?.parentSession,
      timestamp,
      type: "session",
      version: CURRENT_SESSION_VERSION,
    };
    this.manager.tree.fileEntries = [header];
    this.manager.tree.byId.clear();
    this.manager.tree.labelsById.clear();
    this.manager.tree.labelTimestampsById.clear();
    this.manager.tree.leafId = null;
    this.flushed = false;

    if (this.persist) {
      const fileTimestamp = timestamp.replace(/[:.]/gu, "-");
      this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
    }
    return this.sessionFile;
  }

  loadEntries(
    entries: sessionManagerTypes.FileEntry[],
    options?: sessionManagerTypes.NewSessionOptions,
  ): void {
    const header = entries.find((e) => e.type === "session") as
      | sessionManagerTypes.SessionHeader
      | undefined;

    if (header === undefined) {
      this.newSession(options);
      this.manager.tree.fileEntries = this.manager.tree.fileEntries.concat(entries);
    } else {
      this.manager.tree.fileEntries = entries;
      this.sessionId = header.id;

      if (migrateToCurrentVersion(this.manager.tree.fileEntries)) {
        this.rewriteFile();
      }
    }

    this.manager.tree.buildIndex();
  }

  private startSessionAt(path: string): void {
    this.newSession();
    this.sessionFile = path;
  }

  setSessionFileInternal(
    sessionFile: string,
    loaded: sessionManagerInternalTypes.LoadedSessionFile,
  ): void {
    const explicitPath = resolvePath(sessionFile);
    this.sessionFile = explicitPath;
    if (loaded === null) {
      this.startSessionAt(explicitPath);
      return;
    }
    if (loaded.entries.length === 0) {
      if (loaded.size > 0) {
        throw new Error(`Session file is not a valid ${APP_NAME} session: ${explicitPath}`);
      }
      this.startSessionAt(explicitPath);
      this.rewriteFile();
    } else {
      this.loadEntries(loaded.entries);
    }
    this.flushed = true;
  }

  initialize(init: sessionManagerInternalTypes.SessionManagerInit): void {
    this.sessionDir = normalizePath(init.sessionDir);
    this.persist = init.persist;
    if (init.file !== undefined) {
      this.setSessionFileInternal(init.file.path, init.file.loaded);
    } else if (init.entries !== undefined && init.entries.length > 0) {
      this.loadEntries(init.entries, init.newSessionOptions);
    } else {
      this.newSession(init.newSessionOptions);
    }
  }
}
