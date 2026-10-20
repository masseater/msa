import ansiSequences from "./ansi-sequences.ts";
import ansiTrackerModule from "./ansi-tracker.ts";

const { isStyleSequence, parseEscapeSequence } = ansiSequences;
type Osc8Terminator = "\x07" | "\x1b\\";

interface ActiveHyperlink {
  params: string;
  url: string;
  terminator: Osc8Terminator;
}

interface SgrState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  hidden: boolean;
  strikethrough: boolean;
  fgColor: string | null;
  bgColor: string | null;
}

type SgrSetter = (state: SgrState) => void;

const SGR_SETTERS: ReadonlyMap<number, SgrSetter> = new Map<number, SgrSetter>([
  [0, (state) => Object.assign(state, emptySgrState())],
  [1, (state) => (state.bold = true)],
  [2, (state) => (state.dim = true)],
  [3, (state) => (state.italic = true)],
  [4, (state) => (state.underline = true)],
  [5, (state) => (state.blink = true)],
  [7, (state) => (state.inverse = true)],
  [8, (state) => (state.hidden = true)],
  [9, (state) => (state.strikethrough = true)],
  [21, (state) => (state.bold = false)],
  [
    22,
    (state) => {
      state.bold = false;
      state.dim = false;
    },
  ],
  [23, (state) => (state.italic = false)],
  [24, (state) => (state.underline = false)],
  [25, (state) => (state.blink = false)],
  [27, (state) => (state.inverse = false)],
  [28, (state) => (state.hidden = false)],
  [29, (state) => (state.strikethrough = false)],
  [39, (state) => (state.fgColor = null)],
  [49, (state) => (state.bgColor = null)],
]);

const SGR_ATTRIBUTE_CODES: ReadonlyArray<readonly [keyof SgrState, string]> = [
  ["bold", "1"],
  ["dim", "2"],
  ["italic", "3"],
  ["underline", "4"],
  ["blink", "5"],
  ["inverse", "7"],
  ["hidden", "8"],
  ["strikethrough", "9"],
];

function emptySgrState(): SgrState {
  return {
    bgColor: null,
    blink: false,
    bold: false,
    dim: false,
    fgColor: null,
    hidden: false,
    inverse: false,
    italic: false,
    strikethrough: false,
    underline: false,
  };
}

function formatOsc8Hyperlink(hyperlink: ActiveHyperlink): string {
  return `\x1b]8;${hyperlink.params};${hyperlink.url}${hyperlink.terminator}`;
}

function sgrParams(ansiCode: string): string | undefined {
  if (!ansiCode.endsWith("m")) return undefined;
  const style = parseEscapeSequence(ansiCode);
  return style !== null && isStyleSequence(style) ? style.body : undefined;
}

function extendedColor(parts: readonly string[], index: number): string[] | undefined {
  if (parts[index + 1] === "5" && parts[index + 2] !== undefined) {
    return parts.slice(index, index + 3);
  }
  if (parts[index + 1] === "2" && parts[index + 4] !== undefined) {
    return parts.slice(index, index + 5);
  }
  return undefined;
}

function applyBasicSgrCode(state: SgrState, code: number): void {
  const setter = SGR_SETTERS.get(code);
  if (setter !== undefined) {
    setter(state);
  } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
    state.fgColor = String(code);
  } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
    state.bgColor = String(code);
  }
}

function applySgrParams(state: SgrState, parts: readonly string[]): void {
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part === undefined) break;
    const code = Number.parseInt(part, 10);
    const color = code === 38 || code === 48 ? extendedColor(parts, i) : undefined;
    if (color === undefined) {
      applyBasicSgrCode(state, code);
      i++;
    } else if (code === 38) {
      state.fgColor = color.join(";");
      i += color.length;
    } else {
      state.bgColor = color.join(";");
      i += color.length;
    }
  }
}

function hasColor(color: string | null): color is string {
  return color !== null && color !== "";
}

export default class AnsiCodeTracker {
  private readonly state: SgrState = emptySgrState();
  private activeHyperlink: ActiveHyperlink | null = null;

  process(ansiCode: string): void {
    const hyperlink = ansiTrackerModule.parseOsc8Hyperlink(ansiCode);
    if (hyperlink !== undefined) {
      this.activeHyperlink = hyperlink;
      return;
    }

    const params = sgrParams(ansiCode);
    if (params === undefined) return;

    if (params === "" || params === "0") {
      this.reset();
      return;
    }

    applySgrParams(this.state, params.split(";"));
  }

  private reset(): void {
    Object.assign(this.state, emptySgrState());
  }

  clear(): void {
    this.reset();
    this.activeHyperlink = null;
  }

  getActiveCodes(): string {
    const codes = SGR_ATTRIBUTE_CODES.filter(([key]) => this.state[key] === true).map(
      ([, code]) => code,
    );
    if (hasColor(this.state.fgColor)) codes.push(this.state.fgColor);
    if (hasColor(this.state.bgColor)) codes.push(this.state.bgColor);

    let result = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
    if (this.activeHyperlink !== null) {
      result += formatOsc8Hyperlink(this.activeHyperlink);
    }
    return result;
  }

  getActiveBackgroundCode(): string {
    return hasColor(this.state.bgColor) ? `\x1b[${this.state.bgColor}m` : "";
  }

  hasActiveCodes(): boolean {
    return (
      SGR_ATTRIBUTE_CODES.some(([key]) => this.state[key] === true) ||
      this.state.fgColor !== null ||
      this.state.bgColor !== null ||
      this.activeHyperlink !== null
    );
  }

  getLineEndReset(): string {
    let result = "";
    if (this.state.underline) {
      result += "\x1b[24m";
    }
    if (this.activeHyperlink !== null) {
      result += ansiTrackerModule.formatOsc8Close(this.activeHyperlink.terminator);
    }
    return result;
  }
}
