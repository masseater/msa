import { StringDecoder } from "string_decoder";

import paths from "../utils/paths.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import SessionHeaderScanLimitError from "./session-header-scan-limit-error.ts";
import sessionManagerShared from "./session-manager-shared.ts";
import sessionManagerSupportPart2 from "./session-manager-support-part2.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { closeSync, openSync, readSync, readdirSync, statSync } = nodeFs;
const { MAX_SESSION_HEADER_SCAN_BYTES } = sessionManagerShared;
const { normalizePath, resolvePath } = paths;
const { join } = platformNode;
const { SESSION_HEADER_READ_BUFFER_SIZE, parseSessionHeaderCandidate } = sessionManagerSupportPart2;

function readSessionHeader(filePath: string): sessionManagerTypes.SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(SESSION_HEADER_READ_BUFFER_SIZE);
    const lineChunks: string[] = [];
    let scannedBytes = 0;

    while (scannedBytes < MAX_SESSION_HEADER_SCAN_BYTES) {
      const readLength = Math.min(buffer.length, MAX_SESSION_HEADER_SCAN_BYTES - scannedBytes);
      const bytesRead = readSync(fd, buffer, 0, readLength, null);
      if (bytesRead === 0) {
        lineChunks.push(decoder.end());
        return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
      }
      scannedBytes += bytesRead;

      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = chunk.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        lineChunks.push(chunk.slice(lineStart, newlineIndex));
        const header = parseSessionHeaderCandidate(lineChunks.join(""));
        if (header !== undefined) return header;
        lineChunks.length = 0;
        lineStart = newlineIndex + 1;
        newlineIndex = chunk.indexOf("\n", lineStart);
      }
      lineChunks.push(chunk.slice(lineStart));
    }

    const probe = Buffer.allocUnsafe(1);
    if (readSync(fd, probe, 0, probe.length, null) === 0) {
      lineChunks.push(decoder.end());
      return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
    }
    throw new SessionHeaderScanLimitError(filePath);
  } finally {
    closeSync(fd);
  }
}

function readSessionHeaderForDiscovery(filePath: string): sessionManagerTypes.SessionHeader | null {
  try {
    return readSessionHeader(filePath);
  } catch {
    return null;
  }
}

function getSessionHeaderCwd(header: sessionManagerTypes.SessionHeader): string | undefined {
  const cwd = (header as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : undefined;
}

function sessionCwdMatches(cwd: string | undefined, resolvedCwd: string): boolean {
  return cwd !== undefined && cwd !== "" && resolvePath(cwd) === resolvedCwd;
}

function findMostRecentSession(sessionDir: string, cwd?: string): string | null {
  const resolvedSessionDir = normalizePath(sessionDir);
  const resolvedCwd = cwd !== undefined && cwd !== "" ? resolvePath(cwd) : undefined;
  try {
    const files = readdirSync(resolvedSessionDir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => join(resolvedSessionDir, file))
      .map((path) => ({ mtime: statSync(path).mtimeMs, path }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const { path } of files) {
      const header = readSessionHeaderForDiscovery(path);
      if (
        header !== null &&
        (resolvedCwd === undefined ||
          resolvedCwd === "" ||
          sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd))
      )
        return path;
    }
    return null;
  } catch {
    return null;
  }
}

const sessionManagerSupportPart3 = {
  findMostRecentSession,
  getSessionHeaderCwd,
  readSessionHeader,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
};

export default sessionManagerSupportPart3;
