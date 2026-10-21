import platformNode from "../platform-node.ts";
import platform from "../platform.ts";
import type SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFormat from "./session-format.ts";

const { generateId, CURRENT_SESSION_VERSION, createSessionId } = sessionFormat;
const { nowIso } = platform;
const { join } = platformNode;

const withoutLabels = (
  path: readonly sessionManagerTypes.SessionEntry[],
): sessionManagerTypes.SessionEntry[] => {
  const result: sessionManagerTypes.SessionEntry[] = [];
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
    result.push(
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
  return result;
};

export default class SessionBranching {
  private readonly manager: SessionManager;

  constructor(manager: SessionManager) {
    this.manager = manager;
  }

  createBranchedSession(leafId: string): string | undefined {
    const { storage, tree } = this.manager;
    const branchPath = tree.getBranch(leafId);
    if (branchPath.length === 0) {
      throw new Error(`Entry ${leafId} not found`);
    }
    const entries = withoutLabels(branchPath);
    const { header, newSessionFile } = this.newHeader(storage.sessionFile);
    tree.fileEntries = [header, ...entries, ...this.labelEntriesFor(entries)];
    storage.sessionId = header.id;
    if (!storage.persist) {
      tree.buildIndex();
      return undefined;
    }

    storage.sessionFile = newSessionFile;
    tree.buildIndex();
    if (tree.hasConversation()) {
      storage.rewriteFile();
      storage.flushed = true;
    } else {
      storage.flushed = false;
    }
    return newSessionFile;
  }

  private labelEntriesFor(
    entries: readonly sessionManagerTypes.SessionEntry[],
  ): sessionManagerTypes.LabelEntry[] {
    const { tree } = this.manager;
    const ids = new Set(entries.map((e) => e.id));
    const labelEntries: sessionManagerTypes.LabelEntry[] = [];
    let parentId = entries[entries.length - 1]?.id || null;
    for (const [targetId, label] of tree.labelsById) {
      if (!entries.some((entry) => entry.id === targetId)) continue;
      const labelEntry: sessionManagerTypes.LabelEntry = {
        id: generateId(new Set(ids)),
        label,
        parentId,
        targetId,
        timestamp: tree.labelTimestampsById.get(targetId)!,
        type: "label",
      };
      ids.add(labelEntry.id);
      labelEntries.push(labelEntry);
      parentId = labelEntry.id;
    }
    return labelEntries;
  }

  private newHeader(previousSessionFile: string | undefined): {
    header: sessionManagerTypes.SessionHeader;
    newSessionFile: string;
  } {
    const { storage } = this.manager;
    const newSessionId = createSessionId();
    const timestamp = nowIso();
    const fileTimestamp = timestamp.replace(/[:.]/gu, "-");
    const header: sessionManagerTypes.SessionHeader = {
      cwd: this.manager.cwd,
      id: newSessionId,
      parentSession: storage.persist ? previousSessionFile : undefined,
      timestamp,
      type: "session",
      version: CURRENT_SESSION_VERSION,
    };
    return {
      header,
      newSessionFile: join(storage.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`),
    };
  }
}
