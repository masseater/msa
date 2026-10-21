import ansiSequences from "./ansi-sequences.ts";
import type terminalColorsTypes from "./terminal-colors.types.ts";

const { escapeSequences, matchStringSequence } = ansiSequences;

function hexToRgb(hex: string): terminalColorsTypes.RgbColor {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { b, g, r };
}

function parseOscHexChannel(channel: string): number | undefined {
  if (!/^[0-9a-f]+$/iu.test(channel)) {
    return undefined;
  }
  const max = 16 ** channel.length - 1;
  if (max <= 0) {
    return undefined;
  }
  return Math.round((parseInt(channel, 16) / max) * 255);
}

const OSC_COLOR_RESPONSE_BODY = /^(?:(1[01])|4;(\d{1,3}));(.*)$/isu;
const COLOR_SCHEME_BODY = /^\?997;(1|2)$/u;

function parseOscColorResponse(
  data: string,
):
  | { target: terminalColorsTypes.OscColorTarget; rgb: terminalColorsTypes.RgbColor | undefined }
  | undefined {
  const [, dynamicColor, paletteIndex, value] =
    matchStringSequence({ body: OSC_COLOR_RESPONSE_BODY, data, kind: "osc" })?.groups ?? [];
  if (value === undefined) {
    return undefined;
  }
  let target: terminalColorsTypes.OscColorTarget;
  if (dynamicColor === "10") {
    target = "foreground";
  } else if (dynamicColor === "11") {
    target = "background";
  } else if (paletteIndex === undefined) {
    throw new Error(`OSC color response has no target: ${JSON.stringify(data)}`);
  } else {
    target = Number.parseInt(paletteIndex, 10);
  }
  return { rgb: parseOscColorValue(value), target };
}

function parseOscColorValue(rawValue: string): terminalColorsTypes.RgbColor | undefined {
  const value = rawValue.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (/^[0-9a-f]{6}$/iu.test(hex)) {
      return hexToRgb(value);
    }
    if (/^[0-9a-f]{12}$/iu.test(hex)) {
      const r = parseOscHexChannel(hex.slice(0, 4));
      const g = parseOscHexChannel(hex.slice(4, 8));
      const b = parseOscHexChannel(hex.slice(8, 12));
      return r !== undefined && g !== undefined && b !== undefined ? { b, g, r } : undefined;
    }
    return undefined;
  }

  const rgbValue = value.replace(/^rgba?:/iu, "");
  const [red, green, blue] = rgbValue.split("/");
  if (red === undefined || green === undefined || blue === undefined) {
    return undefined;
  }
  const r = parseOscHexChannel(red);
  const g = parseOscHexChannel(green);
  const b = parseOscHexChannel(blue);
  return r !== undefined && g !== undefined && b !== undefined ? { b, g, r } : undefined;
}

function parseTerminalColorSchemeReport(
  data: string,
): terminalColorsTypes.TerminalColorScheme | undefined {
  const sequences = escapeSequences(data);
  const consumed = sequences.reduce((total, sequence) => total + sequence.raw.length, 0);
  if (sequences.length === 0 || consumed !== data.length) {
    return undefined;
  }
  const reports = sequences.map((sequence) =>
    sequence.kind === "csi" && sequence.final === "n"
      ? COLOR_SCHEME_BODY.exec(sequence.body)
      : null,
  );
  if (reports.includes(null)) {
    return undefined;
  }
  return reports[reports.length - 1]?.[1] === "2" ? "light" : "dark";
}

const terminalColors = {
  parseOscColorResponse,
  parseTerminalColorSchemeReport,
};

export default terminalColors;
