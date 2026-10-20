import { dual } from "effect/Function";

import AnsiCodeTracker from "./ansi-code-tracker.ts";
import utils from "./utils.ts";

const { ansiCodeLength, extractAnsiCode } = utils;

type Osc8Terminator = "\x07" | "\x1b\\";

interface ActiveHyperlink {
  params: string;
  url: string;
  terminator: Osc8Terminator;
}

function parseOsc8Hyperlink(ansiCode: string): ActiveHyperlink | null | undefined {
  if (!ansiCode.startsWith("\x1b]8;")) {
    return undefined;
  }

  const terminator: Osc8Terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1b\\";
  const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
  const separatorIndex = body.indexOf(";");
  if (separatorIndex === -1) {
    return undefined;
  }

  const params = body.slice(0, separatorIndex);
  const url = body.slice(separatorIndex + 1);
  if (url === "") {
    return null;
  }
  return { params, terminator, url };
}

function formatOsc8Close(terminator: Osc8Terminator): string {
  return `\x1b]8;;${terminator}`;
}

function getActiveOsc8Close(prefix: string): string {
  if (!prefix.includes("\x1b]8;")) {
    return "";
  }

  let activeHyperlink: ActiveHyperlink | null = null;
  let i = 0;
  while (i < prefix.length) {
    const ansi = extractAnsiCode(prefix, i);
    if (ansi === null) {
      i++;
    } else {
      const hyperlink = parseOsc8Hyperlink(ansi.code);
      if (hyperlink !== undefined) {
        activeHyperlink = hyperlink;
      }
      i += ansi.length;
    }
  }
  return activeHyperlink === null ? "" : formatOsc8Close(activeHyperlink.terminator);
}

const updateTrackerFromText: {
  (text: string, tracker: AnsiCodeTracker): void;
  (tracker: AnsiCodeTracker): (text: string) => void;
} = dual(2, (text: string, tracker: AnsiCodeTracker): void => {
  let i = text.indexOf("\x1b");
  while (i !== -1) {
    const length = ansiCodeLength(text, i);
    if (length > 0) {
      tracker.process(text.substring(i, i + length));
      i += length;
    } else {
      i++;
    }
    i = text.indexOf("\x1b", i);
  }
});

function getActiveBackgroundAnsi(text: string): string {
  const tracker = new AnsiCodeTracker();
  updateTrackerFromText(text, tracker);
  return tracker.getActiveBackgroundCode();
}

const ansiTracker = {
  AnsiCodeTracker,
  formatOsc8Close,
  getActiveBackgroundAnsi,
  getActiveOsc8Close,
  parseOsc8Hyperlink,
  updateTrackerFromText,
};

export default ansiTracker;
