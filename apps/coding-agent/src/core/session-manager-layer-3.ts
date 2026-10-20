import config from "../config.ts";
import paths from "../utils/paths.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";
import sessionManagerHelpers from "./session-manager-helpers.ts";
import SessionManagerLayer2 from "./session-manager-layer-2.ts";
import sessionManagerSupport from "./session-manager-support.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { resolvePath } = paths;
const { existsSync, statSync } = nodeFs;
const { CURRENT_SESSION_VERSION, generateId, loadEntriesFromFile } = sessionManagerSupport;
const { APP_NAME } = config;
const { nowIso } = platform;
const { join } = platformNode;
const { createSessionId } = sessionManagerHelpers;

export default abstract class SessionManagerLayer3 extends SessionManagerLayer2 {
  setSessionFile(sessionFile: string): void {
    this.setSessionFileInternal(sessionFile);
  }

  protected setSessionFileInternal(
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

  createBranchedSession(leafId: string): string | undefined {
    const previousSessionFile = this.sessionFile;
    const {
      pathWithoutLabels,
      header,
      newSessionId,
      newSessionFile,
    }: {
      pathWithoutLabels: sessionManagerTypes.SessionEntry[];
      header: sessionManagerTypes.SessionHeader;
      newSessionId: string;
      newSessionFile: string;
    } = this.createBranchedSessionPart1(leafId, previousSessionFile);

    const pathEntryIds = new Set(pathWithoutLabels.map((e) => e.id));
    const labelsToWrite: Array<{ targetId: string; label: string; timestamp: string }> = [];
    for (const [targetId, label] of this.labelsById) {
      if (pathEntryIds.has(targetId)) {
        labelsToWrite.push({ label, targetId, timestamp: this.labelTimestampsById.get(targetId)! });
      }
    }

    if (this.persist) {
      const lastEntryId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
      let parentId = lastEntryId;
      const labelEntries: sessionManagerTypes.LabelEntry[] = [];
      for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
        const labelEntry: sessionManagerTypes.LabelEntry = {
          id: generateId(new Set(pathEntryIds)),
          label,
          parentId,
          targetId,
          timestamp: labelTimestamp,
          type: "label",
        };
        pathEntryIds.add(labelEntry.id);
        labelEntries.push(labelEntry);
        parentId = labelEntry.id;
      }

      this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
      this.sessionId = newSessionId;
      this.sessionFile = newSessionFile;
      this.buildIndex();

      if (this.hasConversation()) {
        this.rewriteFile();
        this.flushed = true;
      } else {
        this.flushed = false;
      }

      return newSessionFile;
    }

    const labelEntries: sessionManagerTypes.LabelEntry[] = [];
    let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
    for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
      const labelEntry: sessionManagerTypes.LabelEntry = {
        id: generateId(new Set([...pathEntryIds, ...labelEntries.map((e) => e.id)])),
        label,
        parentId,
        targetId,
        timestamp: labelTimestamp,
        type: "label",
      };
      labelEntries.push(labelEntry);
      parentId = labelEntry.id;
    }
    this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
    this.sessionId = newSessionId;
    this.buildIndex();
    return undefined;
  }

  protected createBranchedSessionPart1(leafId: string, previousSessionFile: string | undefined) {
    const path = this.getBranch(leafId);
    if (path.length === 0) {
      throw new Error(`Entry ${leafId} not found`);
    }

    const pathWithoutLabels: sessionManagerTypes.SessionEntry[] = [];
    const replacementByLabelId = new Map<string, string>();
    const pendingLabelIds: string[] = [];
    let pathParentId: string | null = null;
    for (const entry of path) {
      if (entry.type === "label") {
        pendingLabelIds.push(entry.id);
        continue;
      }
      for (const labelId of pendingLabelIds) {
        replacementByLabelId.set(labelId, entry.id);
      }
      pendingLabelIds.length = 0;
      pathWithoutLabels.push(
        entry.type === "compaction"
          ? {
              ...entry,
              firstKeptEntryId:
                entry.firstKeptEntryId === entry.id
                  ? entry.id
                  : (replacementByLabelId.get(entry.firstKeptEntryId) ?? entry.firstKeptEntryId),
              parentId: pathParentId,
            }
          : { ...entry, parentId: pathParentId },
      );
      pathParentId = entry.id;
    }

    const newSessionId = createSessionId();
    const timestamp = nowIso();
    const fileTimestamp = timestamp.replace(/[:.]/gu, "-");
    const newSessionFile = join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);

    const header: sessionManagerTypes.SessionHeader = {
      cwd: this.cwd,
      id: newSessionId,
      parentSession: this.persist ? previousSessionFile : undefined,
      timestamp,
      type: "session",
      version: CURRENT_SESSION_VERSION,
    };
    return { header, newSessionFile, newSessionId, pathWithoutLabels };
  }
}
