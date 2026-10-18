const ANSI_COLORS = [
  "#000000",
  "#800000",
  "#008000",
  "#808000",
  "#000080",
  "#800080",
  "#008080",
  "#c0c0c0",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0000ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

function color256ToHex(index: number): string {
  const standardColor = ANSI_COLORS[index];
  if (index < 16 && standardColor !== undefined) {
    return standardColor;
  }

  if (index < 232) {
    const cubeIndex = index - 16;
    const r = Math.floor(cubeIndex / 36);
    const g = Math.floor((cubeIndex % 36) / 6);
    const b = cubeIndex % 6;
    const toComponent = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    const toHex = (n: number) => toComponent(n).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const gray = 8 + (index - 232) * 10;
  const grayHex = gray.toString(16).padStart(2, "0");
  return `#${grayHex}${grayHex}${grayHex}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

interface TextStyle {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

function createEmptyStyle(): TextStyle {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  };
}

function styleToInlineCSS(style: TextStyle): string {
  const parts: string[] = [];
  if (style.fg !== null && style.fg !== "") parts.push(`color:${style.fg}`);
  if (style.bg !== null && style.bg !== "") parts.push(`background-color:${style.bg}`);
  if (style.bold) parts.push("font-weight:bold");
  if (style.dim) parts.push("opacity:0.6");
  if (style.italic) parts.push("font-style:italic");
  if (style.underline) parts.push("text-decoration:underline");
  return parts.join(";");
}

function hasStyle(style: TextStyle): boolean {
  return (
    style.fg !== null ||
    style.bg !== null ||
    style.bold ||
    style.dim ||
    style.italic ||
    style.underline
  );
}

const SGR_ACTIONS: Record<number, (style: TextStyle) => void> = {
  0: (style) => {
    style.fg = null;
    style.bg = null;
    style.bold = false;
    style.dim = false;
    style.italic = false;
    style.underline = false;
  },
  1: (style) => {
    style.bold = true;
  },
  2: (style) => {
    style.dim = true;
  },
  3: (style) => {
    style.italic = true;
  },
  4: (style) => {
    style.underline = true;
  },
  22: (style) => {
    style.bold = false;
    style.dim = false;
  },
  23: (style) => {
    style.italic = false;
  },
  24: (style) => {
    style.underline = false;
  },
  39: (style) => {
    style.fg = null;
  },
  49: (style) => {
    style.bg = null;
  },
};

function applyPaletteColor(code: number, style: TextStyle): void {
  if (code >= 30 && code <= 37) style.fg = ANSI_COLORS[code - 30] ?? null;
  else if (code >= 40 && code <= 47) style.bg = ANSI_COLORS[code - 40] ?? null;
  else if (code >= 90 && code <= 97) style.fg = ANSI_COLORS[code - 90 + 8] ?? null;
  else if (code >= 100 && code <= 107) style.bg = ANSI_COLORS[code - 100 + 8] ?? null;
}

function readExtendedColor(
  params: number[],
  index: number,
): { color: string; consumed: number } | undefined {
  const colorIndex = params[index + 2];
  if (params[index + 1] === 5 && colorIndex !== undefined) {
    return { color: color256ToHex(colorIndex), consumed: 2 };
  }
  if (params[index + 1] === 2 && params.length > index + 4) {
    const [r, g, b] = [params[index + 2], params[index + 3], params[index + 4]];
    return { color: `rgb(${r},${g},${b})`, consumed: 4 };
  }
  return undefined;
}

function applySingleCode(params: number[], index: number, style: TextStyle): number {
  const code = params[index] ?? 0;
  const action = SGR_ACTIONS[code];
  if (action !== undefined) {
    action(style);
    return 0;
  }
  if (code !== 38 && code !== 48) {
    applyPaletteColor(code, style);
    return 0;
  }
  const extended = readExtendedColor(params, index);
  if (extended === undefined) return 0;
  if (code === 38) style.fg = extended.color;
  else style.bg = extended.color;
  return extended.consumed;
}

function applySgrCode(params: number[], style: TextStyle): void {
  let i = 0;
  while (i < params.length) {
    const code = params[i];
    if (code === undefined) break;
    i += applySingleCode(params, i, style) + 1;
  }
}

const ESC = String.fromCodePoint(27);
const ANSI_REGEX = new RegExp(`${ESC}\\[([\\d;]*)m`, "gu");

export function ansiToHtml(text: string): string {
  const style = createEmptyStyle();
  let result = "";
  let lastIndex = 0;
  let inSpan = false;

  ANSI_REGEX.lastIndex = 0;

  let match = ANSI_REGEX.exec(text);
  while (match !== null) {
    const beforeText = text.slice(lastIndex, match.index);
    if (beforeText !== "") {
      result += escapeHtml(beforeText);
    }

    const paramStr = match[1];
    const params =
      paramStr !== undefined && paramStr !== ""
        ? paramStr.split(";").map((p) => parseInt(p, 10) || 0)
        : [0];

    if (inSpan) {
      result += "</span>";
      inSpan = false;
    }

    applySgrCode(params, style);

    if (hasStyle(style)) {
      result += `<span style="${styleToInlineCSS(style)}">`;
      inSpan = true;
    }

    lastIndex = match.index + match[0].length;
    match = ANSI_REGEX.exec(text);
  }

  const remainingText = text.slice(lastIndex);
  if (remainingText !== "") {
    result += escapeHtml(remainingText);
  }

  if (inSpan) {
    result += "</span>";
  }

  return result;
}

export function ansiLinesToHtml(lines: string[]): string {
  return lines
    .map((line) => `<div class="ansi-line">${ansiToHtml(line) || "&nbsp;"}</div>`)
    .join("");
}
