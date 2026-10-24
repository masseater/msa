import { Buffer } from "node:buffer";

import * as NodePath from "@effect/platform-node/NodePath";
import { ManagedRuntime, Path, Schema } from "effect";
import { dual } from "effect/Function";

import type sessionTypes from "./session.types.ts";

const nodePath = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

const GIST_ID_RE = /^[0-9a-fA-F]{20,}$/u;
const GIST_URL_RE = /^https:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-fA-F]{20,})(?:[/#?].*)?$/u;
const SHARE_URL_RE = /^https:\/\/msa\.dev\/session\/#([0-9a-fA-F]{20,})(?:[/#?].*)?$/u;
const ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/#?].*)?$/u;
const SESSION_DATA_RE = /<script id="session-data" type="application\/json">([^<]+)<\/script>/u;

class ImportReproError extends Schema.TaggedError<
  ImportReproError,
  { readonly brand: unique symbol }
>()("ImportReproError", { message: Schema.String }) {}

interface ExportedSessionData {
  header: sessionTypes.SessionHeader | null;
  entries: Record<string, unknown>[];
}

const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const parseRef: {
  (cwd: string): (ref: string) => sessionTypes.SessionRef;
  (ref: string, cwd: string): sessionTypes.SessionRef;
} = dual(2, (ref: string, cwd: string): sessionTypes.SessionRef => {
  if (ref.endsWith(".html") || ref.endsWith(".jsonl")) {
    return { path: nodePath.isAbsolute(ref) ? ref : nodePath.resolve(cwd, ref), type: "file" };
  }

  const [, shareId] = SHARE_URL_RE.exec(ref) ?? [];
  if (isPresent(shareId)) return { id: shareId, type: "gist" };

  const [, gistId] = GIST_URL_RE.exec(ref) ?? [];
  if (isPresent(gistId)) return { id: gistId, type: "gist" };

  const [, owner, repo, issue] = ISSUE_URL_RE.exec(ref) ?? [];
  if (isPresent(owner) && isPresent(repo) && isPresent(issue)) {
    return { issue, owner, repo, type: "issue" };
  }

  if (GIST_ID_RE.test(ref)) return { id: ref, type: "gist" };

  throw ImportReproError.make({
    message: `expected a gist ID, gist URL, pi.dev share URL, issue URL, .html file, or .jsonl file: ${ref}`,
  });
});

function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw ImportReproError.make({ message });
  }
}

function parseSessionJsonl(raw: string): sessionTypes.DecodedSession {
  const newlineIndex = raw.indexOf("\n");
  const firstLine = newlineIndex === -1 ? raw : raw.slice(0, newlineIndex);
  const header = parseJson(
    firstLine,
    "first line of session file is not valid JSON",
  ) as Partial<sessionTypes.SessionHeader>;
  if (
    header.type !== "session" ||
    typeof header.id !== "string" ||
    typeof header.cwd !== "string" ||
    header.cwd === ""
  ) {
    throw ImportReproError.make({
      message: "session file has no valid session header with a cwd",
    });
  }
  return { header: header as sessionTypes.SessionHeader, jsonl: raw };
}

function decodeExportedHtml(html: string): sessionTypes.DecodedSession {
  const [, encoded] = SESSION_DATA_RE.exec(html) ?? [];
  if (!isPresent(encoded)) {
    throw ImportReproError.make({ message: "HTML does not contain embedded msa session data" });
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
    throw ImportReproError.make({
      message: "embedded msa session data has no valid session header",
    });
  }
  if (!Array.isArray(sessionData.entries)) {
    throw ImportReproError.make({ message: "embedded msa session data has no entries array" });
  }

  const lines = [header, ...sessionData.entries].map((entry) => JSON.stringify(entry));
  return { header, jsonl: `${lines.join("\n")}\n` };
}

const session = {
  ImportReproError,
  decodeExportedHtml,
  parseRef,
  parseSessionJsonl,
};

export default session;
