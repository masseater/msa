import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";
import type SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFiles from "./session-files.ts";
import sessionFormat from "./session-format.ts";

const { appendFileSync, closeSync, existsSync, mkdirSync, openSync, statSync, writeFileSync } =
  nodeFs;
const { getDefaultSessionDirPath, loadEntriesFromFile } = sessionFiles;
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

  rewriteFile(): void {
    if (!this.persist || this.sessionFile === undefined || this.sessionFile === "") return;
    const fd = openSync(this.sessionFile, "w");
    try {
      for (const entry of this.manager.tree.fileEntries) {
        writeFileSync(fd, `${JSON.stringify(entry)}\n`);
      }
    } finally {
      closeSync(fd);
    }
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
      appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    } else {
      if (!this.manager.tree.hasConversation()) return;
      const fd = openSync(this.sessionFile, "wx");
      try {
        for (const e of this.manager.tree.fileEntries) {
          writeFileSync(fd, `${JSON.stringify(e)}\n`);
        }
      } finally {
        closeSync(fd);
      }
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

  setSessionFileInternal(
    sessionFile: string,
    preloadedFileEntries?: sessionManagerTypes.FileEntry[],
  ): void {
    this.sessionFile = resolvePath(sessionFile);
    if (existsSync(this.sessionFile)) {
      const entries = preloadedFileEntries ?? loadEntriesFromFile(this.sessionFile);

      if (entries.length === 0) {
        const explicitPath = this.sessionFile;
        if (statSync(explicitPath).size > 0) {
          throw new Error(`Session file is not a valid ${APP_NAME} session: ${explicitPath}`);
        }
        this.newSession();
        this.sessionFile = explicitPath;
        this.rewriteFile();
        this.flushed = true;
        return;
      }

      this.loadEntries(entries);
      this.flushed = true;
    } else {
      const explicitPath = this.sessionFile;
      this.newSession();
      this.sessionFile = explicitPath;
    }
  }

  initialize(
    sessionDir: string,
    persist: boolean,
    sessionFile: string | undefined,
    preloadedFileEntries: sessionManagerTypes.FileEntry[] | undefined,
    newSessionOptions: sessionManagerTypes.NewSessionOptions | undefined,
  ): void {
    this.sessionDir = normalizePath(sessionDir);
    this.persist = persist;
    if (persist && this.sessionDir !== "" && !existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
    if (sessionFile !== undefined && sessionFile !== "") {
      this.setSessionFileInternal(sessionFile, preloadedFileEntries);
    } else if (preloadedFileEntries?.length !== undefined && preloadedFileEntries?.length !== 0) {
      this.loadEntries(preloadedFileEntries, newSessionOptions);
    } else {
      this.newSession(newSessionOptions);
    }
  }
}
