import ansiSequences from "./ansi-sequences.ts";
import type programStatusTypes from "./program-status.types.ts";

const { matchStringSequence, replaceControlRuns } = ansiSequences;

const PROGRAM_STATUS_QUERY = "\x1b]7501;?\x1b\\";

function isProgramStatusReply(sequence: string): boolean {
  return matchStringSequence({ body: PROGRAM_STATUS_BODY, data: sequence, kind: "osc" }) !== null;
}

const BASE_KINDS: ReadonlySet<string> = new Set(["permission", "question", "auth"]);

function programStatusReplyKinds(sequence: string): ReadonlySet<string> {
  const reply = matchStringSequence({ body: PROGRAM_STATUS_BODY, data: sequence, kind: "osc" });
  const kinds = reply?.groups[0]
    ?.split(":")
    .find((pair) => pair.startsWith("kinds="))
    ?.slice("kinds=".length);
  return kinds === undefined ? BASE_KINDS : new Set(kinds.split(","));
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

function formatProgramStatus(
  status: programStatusTypes.ProgramStatus,
  kinds: ReadonlySet<string> = BASE_KINDS,
): string {
  const pairs = [`state=${status.state}`];
  if (status.app !== undefined && APP_PATTERN.test(status.app)) pairs.push(`app=${status.app}`);
  if (status.state === "blocked" && status.kind !== undefined && kinds.has(status.kind))
    pairs.push(`kind=${status.kind}`);
  const message = truncateUtf8(
    replaceControlRuns(status.message ?? "", " ").trim(),
    MAX_MESSAGE_BYTES,
  );
  if (message !== "") pairs.push(`msg=${Buffer.from(message, "utf8").toString("base64")}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}

const MAX_ALERT_BYTES = 256;

const tmuxPassthrough = (sequence: string): string =>
  `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;

function formatAttentionAlert(
  app: string,
  message: string,
  options: { readonly tmux?: boolean } = {},
): string {
  const text = truncateUtf8(
    replaceControlRuns(message, " ").replaceAll(";", ",").trim(),
    MAX_ALERT_BYTES,
  );
  const name = APP_PATTERN.test(app) ? app : "app";
  const notifications = [`\x1b]9;${name}: ${text}\x07`, `\x1b]777;notify;${name};${text}\x07`];
  const wrap = options.tmux === true ? tmuxPassthrough : (sequence: string) => sequence;
  return `${notifications.map(wrap).join("")}\x07`;
}

const programStatus = {
  PROGRAM_STATUS_QUERY,
  formatAttentionAlert,
  formatProgramStatus,
  isProgramStatusReply,
  programStatusReplyKinds,
};

export default programStatus;
