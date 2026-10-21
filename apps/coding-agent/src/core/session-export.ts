import paths from "../utils/paths.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import sessionFormat from "./session-manager/session-format.ts";

const { existsSync, mkdirSync, writeFileSync } = nodeFs;

const { CURRENT_SESSION_VERSION } = sessionFormat;
const { nowIso } = platform;
const { resolvePath } = paths;
const { dirname } = platformNode;

type TrailingEntries = (parentId: string | null, timestamp: string) => readonly object[];

function serializeSessionBranch(
  sessionManager: sessionManagerTypes.SessionManager,
  createTrailingEntries?: TrailingEntries,
): string {
  const timestamp = nowIso();
  const header: sessionManagerTypes.SessionHeader = {
    cwd: sessionManager.getCwd(),
    id: sessionManager.getSessionId(),
    timestamp,
    type: "session",
    version: CURRENT_SESSION_VERSION,
  };
  const entries: object[] = [header];
  let parentId: string | null = null;
  for (const entry of sessionManager.getBranch()) {
    entries.push({ ...entry, parentId });
    parentId = entry.id;
  }
  entries.push(...(createTrailingEntries?.(parentId, timestamp) ?? []));
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function exportSessionToJsonl(
  sessionManager: sessionManagerTypes.SessionManager,
  outputPath?: string,
): string {
  const filePath = resolvePath(
    outputPath ?? `session-${nowIso().replace(/[:.]/gu, "-")}.jsonl`,
    process.cwd(),
  );
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, serializeSessionBranch(sessionManager));
  return filePath;
}

const sessionExport = {
  exportSessionToJsonl,
  serializeSessionBranch,
};

export default sessionExport;
