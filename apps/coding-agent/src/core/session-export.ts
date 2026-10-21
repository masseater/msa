import paths from "../utils/paths.ts";
import platform from "./platform/index.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import sessionFormat from "./session-manager/session-format.ts";

const { makeDirectory, writeFile } = platform.files;

const { CURRENT_SESSION_VERSION } = sessionFormat;
const { dirname, nowIso } = platform;
const { resolvePath } = paths;

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
): Promise<string> {
  const filePath = resolvePath(
    outputPath ?? `session-${nowIso().replace(/[:.]/gu, "-")}.jsonl`,
    process.cwd(),
  );
  return makeDirectory({ path: dirname(filePath) })
    .then(() => writeFile({ data: serializeSessionBranch(sessionManager), path: filePath }))
    .then(() => filePath);
}

const sessionExport = {
  exportSessionToJsonl,
  serializeSessionBranch,
};

export default sessionExport;
