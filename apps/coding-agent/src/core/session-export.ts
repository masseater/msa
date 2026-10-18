import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { resolvePath } from "../utils/paths.ts";
import { dirname } from "./platform-node.ts";
import { nowIso } from "./platform.ts";
import {
  CURRENT_SESSION_VERSION,
  type SessionHeader,
  type SessionManager,
} from "./session-manager.ts";

type TrailingEntries = (parentId: string | null, timestamp: string) => readonly object[];

export function serializeSessionBranch(
  sessionManager: SessionManager,
  createTrailingEntries?: TrailingEntries,
): string {
  const timestamp = nowIso();
  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: sessionManager.getSessionId(),
    timestamp,
    cwd: sessionManager.getCwd(),
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

export function exportSessionToJsonl(sessionManager: SessionManager, outputPath?: string): string {
  const filePath = resolvePath(
    outputPath ?? `session-${nowIso().replace(/[:.]/gu, "-")}.jsonl`,
    process.cwd(),
  );
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, serializeSessionBranch(sessionManager));
  return filePath;
}
