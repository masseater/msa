import { matchStringSequence, replaceControlRuns } from "./ansi-sequences.ts";

export interface ProgramStatus {
  state: "idle" | "working" | "blocked" | "done" | "error" | "clear";
  app?: string;
  kind?: "permission" | "question" | "auth";
  message?: string;
}

export const PROGRAM_STATUS_QUERY = "\x1b]7501;?\x1b\\";

export function isProgramStatusReply(sequence: string): boolean {
  return matchStringSequence({ data: sequence, kind: "osc", body: PROGRAM_STATUS_BODY }) !== null;
}

const APP_PATTERN = /^[A-Za-z0-9_.+-]{1,32}$/u;
const PROGRAM_STATUS_BODY = /^7501;\?.*$/su;
const MAX_MESSAGE_BYTES = 2048;

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}

export function formatProgramStatus(status: ProgramStatus): string {
  const pairs = [`state=${status.state}`];
  if (status.app !== undefined && APP_PATTERN.test(status.app)) pairs.push(`app=${status.app}`);
  if (status.state === "blocked" && status.kind !== undefined) pairs.push(`kind=${status.kind}`);
  const message = truncateUtf8(
    replaceControlRuns(status.message ?? "", " ").trim(),
    MAX_MESSAGE_BYTES,
  );
  if (message !== "") pairs.push(`msg=${Buffer.from(message, "utf8").toString("base64")}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}
