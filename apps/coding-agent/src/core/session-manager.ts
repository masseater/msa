import paths from "../utils/paths.ts";
import type sessionManagerInternalTypes from "./session-manager-internal.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import SessionAppends from "./session-manager/session-appends.ts";
import SessionBranching from "./session-manager/session-branching.ts";
import sessionFiles from "./session-manager/session-files.ts";
import sessionListing from "./session-manager/session-listing.ts";
import sessionLocations from "./session-manager/session-locations.ts";
import SessionStorage from "./session-manager/session-storage.ts";
import SessionTree from "./session-manager/session-tree.ts";
const { resolvePath } = paths;

export default class SessionManager {
  readonly tree: SessionTree;
  readonly storage: SessionStorage;
  readonly appends: SessionAppends;
  readonly branching: SessionBranching;

  cwd!: string;

  getCwd(): string {
    return this.cwd;
  }

  static create(
    cwd: string,
    sessionDir?: string,
    options?: sessionManagerTypes.NewSessionOptions,
  ): SessionManager {
    return new SessionManager({
      cwd,
      newSessionOptions: options,
      persist: true,
      sessionDir: sessionLocations.sessionDirFor(cwd, sessionDir),
    });
  }

  private static fromFile(location: {
    cwd: string;
    dir: string;
    file: string | undefined;
    preloadedFileEntries?: sessionManagerTypes.FileEntry[] | undefined;
  }): Promise<SessionManager> {
    const { cwd, dir, file } = location;
    if (file === undefined) {
      return Promise.resolve(new SessionManager({ cwd, persist: true, sessionDir: dir }));
    }
    return sessionFiles
      .loadSessionFile(file, location.preloadedFileEntries)
      .then(
        (loaded) =>
          new SessionManager({ cwd, file: { loaded, path: file }, persist: true, sessionDir: dir }),
      );
  }

  static open(path: string, sessionDir?: string, cwdOverride?: string): Promise<SessionManager> {
    return sessionLocations
      .locateExisting(path, sessionDir, cwdOverride)
      .then((location) => SessionManager.fromFile(location));
  }

  static continueRecent(cwd: string, sessionDir?: string): Promise<SessionManager> {
    return sessionLocations
      .locateRecent(cwd, sessionDir)
      .then((location) => SessionManager.fromFile(location));
  }

  static readonly findById = sessionListing.findById;

  static readonly list = sessionListing.list;

  static readonly listAll = sessionListing.listAll;

  static inMemory(
    cwd: string = process.cwd(),
    options?: sessionManagerTypes.NewSessionOptions,
    entries?: sessionManagerTypes.FileEntry[],
  ): SessionManager {
    return new SessionManager({
      cwd,
      entries,
      newSessionOptions: options,
      persist: false,
      sessionDir: "",
    });
  }

  static forkFrom(
    sourcePath: string,
    targetCwd: string,
    sessionDir?: string,
    options?: sessionManagerTypes.NewSessionOptions,
  ): Promise<SessionManager> {
    return sessionLocations
      .writeFork(sourcePath, targetCwd, sessionDir, options)
      .then((location) => SessionManager.fromFile(location));
  }

  getLeafId(...args: Parameters<SessionTree["getLeafId"]>): ReturnType<SessionTree["getLeafId"]> {
    return this.tree.getLeafId(...args);
  }

  getLeafEntry(
    ...args: Parameters<SessionTree["getLeafEntry"]>
  ): ReturnType<SessionTree["getLeafEntry"]> {
    return this.tree.getLeafEntry(...args);
  }

  getEntry(...args: Parameters<SessionTree["getEntry"]>): ReturnType<SessionTree["getEntry"]> {
    return this.tree.getEntry(...args);
  }

  getChildren(
    ...args: Parameters<SessionTree["getChildren"]>
  ): ReturnType<SessionTree["getChildren"]> {
    return this.tree.getChildren(...args);
  }

  getLabel(...args: Parameters<SessionTree["getLabel"]>): ReturnType<SessionTree["getLabel"]> {
    return this.tree.getLabel(...args);
  }

  getBranch(...args: Parameters<SessionTree["getBranch"]>): ReturnType<SessionTree["getBranch"]> {
    return this.tree.getBranch(...args);
  }

  buildContextEntries(
    ...args: Parameters<SessionTree["buildContextEntries"]>
  ): ReturnType<SessionTree["buildContextEntries"]> {
    return this.tree.buildContextEntries(...args);
  }

  buildSessionProjection(
    ...args: Parameters<SessionTree["buildSessionProjection"]>
  ): ReturnType<SessionTree["buildSessionProjection"]> {
    return this.tree.buildSessionProjection(...args);
  }

  buildSessionContext(
    ...args: Parameters<SessionTree["buildSessionContext"]>
  ): ReturnType<SessionTree["buildSessionContext"]> {
    return this.tree.buildSessionContext(...args);
  }

  getHeader(...args: Parameters<SessionTree["getHeader"]>): ReturnType<SessionTree["getHeader"]> {
    return this.tree.getHeader(...args);
  }

  getEntryCount(
    ...args: Parameters<SessionTree["getEntryCount"]>
  ): ReturnType<SessionTree["getEntryCount"]> {
    return this.tree.getEntryCount(...args);
  }

  getEntries(
    ...args: Parameters<SessionTree["getEntries"]>
  ): ReturnType<SessionTree["getEntries"]> {
    return this.tree.getEntries(...args);
  }

  branch(...args: Parameters<SessionTree["branch"]>): ReturnType<SessionTree["branch"]> {
    return this.tree.branch(...args);
  }

  resetLeaf(...args: Parameters<SessionTree["resetLeaf"]>): ReturnType<SessionTree["resetLeaf"]> {
    return this.tree.resetLeaf(...args);
  }

  getTree(...args: Parameters<SessionTree["getTree"]>): ReturnType<SessionTree["getTree"]> {
    return this.tree.getTree(...args);
  }

  getSessionName(
    ...args: Parameters<SessionTree["getSessionName"]>
  ): ReturnType<SessionTree["getSessionName"]> {
    return this.tree.getSessionName(...args);
  }

  isPersisted(
    ...args: Parameters<SessionStorage["isPersisted"]>
  ): ReturnType<SessionStorage["isPersisted"]> {
    return this.storage.isPersisted(...args);
  }

  getSessionDir(
    ...args: Parameters<SessionStorage["getSessionDir"]>
  ): ReturnType<SessionStorage["getSessionDir"]> {
    return this.storage.getSessionDir(...args);
  }

  usesDefaultSessionDir(
    ...args: Parameters<SessionStorage["usesDefaultSessionDir"]>
  ): ReturnType<SessionStorage["usesDefaultSessionDir"]> {
    return this.storage.usesDefaultSessionDir(...args);
  }

  getSessionId(
    ...args: Parameters<SessionStorage["getSessionId"]>
  ): ReturnType<SessionStorage["getSessionId"]> {
    return this.storage.getSessionId(...args);
  }

  getSessionFile(
    ...args: Parameters<SessionStorage["getSessionFile"]>
  ): ReturnType<SessionStorage["getSessionFile"]> {
    return this.storage.getSessionFile(...args);
  }

  newSession(
    ...args: Parameters<SessionStorage["newSession"]>
  ): ReturnType<SessionStorage["newSession"]> {
    return this.storage.newSession(...args);
  }

  appendThinkingLevelChange(
    ...args: Parameters<SessionAppends["appendThinkingLevelChange"]>
  ): ReturnType<SessionAppends["appendThinkingLevelChange"]> {
    return this.appends.appendThinkingLevelChange(...args);
  }

  appendModelChange(
    ...args: Parameters<SessionAppends["appendModelChange"]>
  ): ReturnType<SessionAppends["appendModelChange"]> {
    return this.appends.appendModelChange(...args);
  }

  appendCustomEntry(
    ...args: Parameters<SessionAppends["appendCustomEntry"]>
  ): ReturnType<SessionAppends["appendCustomEntry"]> {
    return this.appends.appendCustomEntry(...args);
  }

  appendSessionInfo(
    ...args: Parameters<SessionAppends["appendSessionInfo"]>
  ): ReturnType<SessionAppends["appendSessionInfo"]> {
    return this.appends.appendSessionInfo(...args);
  }

  appendLabelChange(
    ...args: Parameters<SessionAppends["appendLabelChange"]>
  ): ReturnType<SessionAppends["appendLabelChange"]> {
    return this.appends.appendLabelChange(...args);
  }

  appendMessage(
    ...args: Parameters<SessionAppends["appendMessage"]>
  ): ReturnType<SessionAppends["appendMessage"]> {
    return this.appends.appendMessage(...args);
  }

  appendUsage(
    ...args: Parameters<SessionAppends["appendUsage"]>
  ): ReturnType<SessionAppends["appendUsage"]> {
    return this.appends.appendUsage(...args);
  }

  appendCompaction(
    ...args: Parameters<SessionAppends["appendCompaction"]>
  ): ReturnType<SessionAppends["appendCompaction"]> {
    return this.appends.appendCompaction(...args);
  }

  appendCustomMessageEntry(
    ...args: Parameters<SessionAppends["appendCustomMessageEntry"]>
  ): ReturnType<SessionAppends["appendCustomMessageEntry"]> {
    return this.appends.appendCustomMessageEntry(...args);
  }

  appendContextEdit(
    ...args: Parameters<SessionAppends["appendContextEdit"]>
  ): ReturnType<SessionAppends["appendContextEdit"]> {
    return this.appends.appendContextEdit(...args);
  }

  branchWithSummary(
    ...args: Parameters<SessionAppends["branchWithSummary"]>
  ): ReturnType<SessionAppends["branchWithSummary"]> {
    return this.appends.branchWithSummary(...args);
  }

  createBranchedSession(
    ...args: Parameters<SessionBranching["createBranchedSession"]>
  ): ReturnType<SessionBranching["createBranchedSession"]> {
    return this.branching.createBranchedSession(...args);
  }

  protected constructor(init: sessionManagerInternalTypes.SessionManagerInit) {
    this.tree = new SessionTree();
    this.storage = new SessionStorage(this);
    this.appends = new SessionAppends(this);
    this.branching = new SessionBranching(this);
    this.cwd = resolvePath(init.cwd);
    this.storage.initialize(init);
  }
}
