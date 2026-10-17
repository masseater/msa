import { Buffer } from "node:buffer";
import { isAbsolute, resolve } from "node:path";

import { Data } from "effect";
import { dual } from "effect/Function";

const GIST_ID_RE = /^[0-9a-fA-F]{20,}$/u;
const GIST_URL_RE = /^https:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-fA-F]{20,})(?:[/#?].*)?$/u;
const SHARE_URL_RE = /^https:\/\/msa\.dev\/session\/#([0-9a-fA-F]{20,})(?:[/#?].*)?$/u;
const ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/#?].*)?$/u;
const SESSION_DATA_RE = /<script id="session-data" type="application\/json">([^<]+)<\/script>/u;

export class ImportReproError extends Data.TaggedError("ImportReproError")<{
  readonly message: string;
}> {}

export interface SessionHeader {
  type: "session";
  id: string;
  cwd: string;
  [key: string]: unknown;
}

export interface DecodedSession {
  header: SessionHeader;
  jsonl: string;
}

interface ExportedSessionData {
  header: SessionHeader | null;
  entries: Record<string, unknown>[];
}

export type SessionRef =
  | { type: "gist"; id: string }
  | { type: "file"; path: string }
  | { type: "issue"; owner: string; repo: string; issue: string };

const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

export type IssueRef = Extract<SessionRef, { type: "issue" }>;

export const parseRef: {
  (cwd: string): (ref: string) => SessionRef;
  (ref: string, cwd: string): SessionRef;
} = dual(2, (ref: string, cwd: string): SessionRef => {
  if (ref.endsWith(".html") || ref.endsWith(".jsonl")) {
    return { type: "file", path: isAbsolute(ref) ? ref : resolve(cwd, ref) };
  }

  const [, shareId] = SHARE_URL_RE.exec(ref) ?? [];
  if (isPresent(shareId)) return { type: "gist", id: shareId };

  const [, gistId] = GIST_URL_RE.exec(ref) ?? [];
  if (isPresent(gistId)) return { type: "gist", id: gistId };

  const [, owner, repo, issue] = ISSUE_URL_RE.exec(ref) ?? [];
  if (isPresent(owner) && isPresent(repo) && isPresent(issue)) {
    return { type: "issue", owner, repo, issue };
  }

  if (GIST_ID_RE.test(ref)) return { type: "gist", id: ref };

  throw new ImportReproError({
    message: `expected a gist ID, gist URL, pi.dev share URL, issue URL, .html file, or .jsonl file: ${ref}`,
  });
});

function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportReproError({ message });
  }
}

export function parseSessionJsonl(raw: string): DecodedSession {
  const newlineIndex = raw.indexOf("\n");
  const firstLine = newlineIndex === -1 ? raw : raw.slice(0, newlineIndex);
  const header = parseJson(
    firstLine,
    "first line of session file is not valid JSON",
  ) as Partial<SessionHeader>;
  if (
    header.type !== "session" ||
    typeof header.id !== "string" ||
    typeof header.cwd !== "string" ||
    header.cwd === ""
  ) {
    throw new ImportReproError({
      message: "session file has no valid session header with a cwd",
    });
  }
  return { header: header as SessionHeader, jsonl: raw };
}

export function decodeExportedHtml(html: string): DecodedSession {
  const [, encoded] = SESSION_DATA_RE.exec(html) ?? [];
  if (!isPresent(encoded)) {
    throw new ImportReproError({ message: "HTML does not contain embedded msa session data" });
  }

  const sessionData = parseJson(
    Buffer.from(encoded, "base64").toString("utf8"),
    "embedded msa session data is not valid JSON",
  ) as Partial<ExportedSessionData>;
  const header = sessionData.header;
  if (
    header === undefined ||
    header === null ||
    header.type !== "session" ||
    typeof header.id !== "string" ||
    typeof header.cwd !== "string"
  ) {
    throw new ImportReproError({
      message: "embedded msa session data has no valid session header",
    });
  }
  if (!Array.isArray(sessionData.entries)) {
    throw new ImportReproError({ message: "embedded msa session data has no entries array" });
  }

  const lines = [header, ...sessionData.entries].map((entry) => JSON.stringify(entry));
  return { header, jsonl: `${lines.join("\n")}\n` };
}
