const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";

const OSC_START = "\\u001B\\]";

const CSI_START = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?";
const CSI_FINAL = "[\\dA-PR-TZcf-nq-uy=><~]";

const ansiRegex = new RegExp(`(?:${OSC_START}[\\s\\S]*?${ST})|${CSI_START}${CSI_FINAL}`, "gu");

const unfinishedAnsiAtEndRegex = new RegExp(
  `(?:${OSC_START}(?:[^\\u0007\\u009C\\u001B]|\\u001B(?!\\\\))*|${CSI_START})$`,
  "u",
);

const MAX_PENDING_ANSI_LENGTH = 256;

export function splitIncompleteAnsiSuffix(value: string): { complete: string; pending: string } {
  if (!value.includes("\u001B") && !value.includes("\u009B")) {
    return { complete: value, pending: "" };
  }
  const windowStart = Math.max(0, value.length - MAX_PENDING_ANSI_LENGTH);
  const match = unfinishedAnsiAtEndRegex.exec(value.slice(windowStart));
  if (match === null) {
    return { complete: value, pending: "" };
  }
  const splitAt = windowStart + match.index;
  return { complete: value.slice(0, splitAt), pending: value.slice(splitAt) };
}

export function stripAnsi(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof value}\``);
  }

  if (!value.includes("\u001B") && !value.includes("\u009B")) {
    return value;
  }

  return value.replace(ansiRegex, "");
}
