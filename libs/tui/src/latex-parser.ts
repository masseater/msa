import latexCommandSets from "./latex-command-sets.ts";
import latexCommands from "./latex-commands.ts";
import latexFormat from "./latex-format.ts";
import type latexFormatTypes from "./latex-format.types.ts";
import latexLayout from "./latex-layout.ts";
import type latexLayoutTypes from "./latex-layout.types.ts";

const { NAMED_OPERATOR_END, formatScript, formatUnicodeScript, normalizeOutput } = latexFormat;
const { NEGATIVE_SPACE } = latexCommandSets;
const { LAYOUT_MARKER_START, TRAILING_LAYOUT_MARKER_PATTERN, layoutMarker } = latexLayout;
const { parseCommand } = latexCommands;

type ScriptMarker = "^" | "_";
type ScriptValues = { sub?: string; sup?: string };

function stripNamedOperatorEnd(value: string): string {
  return value.endsWith(NAMED_OPERATOR_END) ? value.slice(0, -NAMED_OPERATOR_END.length) : value;
}

function appendCommand(result: string, command: string): string {
  return command === NEGATIVE_SPACE ? stripNamedOperatorEnd(result.trimEnd()) : result + command;
}

function appendScript(result: string, script: string): string {
  return result.endsWith(NAMED_OPERATOR_END)
    ? `${stripNamedOperatorEnd(result)}${script}${NAMED_OPERATOR_END}`
    : result + script;
}

function appendToTrailingMatrix(
  result: string,
  nodes: readonly latexLayoutTypes.LayoutNode[],
): boolean {
  const marker = TRAILING_LAYOUT_MARKER_PATTERN.exec(result);
  const node = marker === null ? undefined : nodes[Number(marker[1])];
  if (node?.type !== "matrix") return false;
  const lastLine = node.lines.length - 1;
  node.lines[lastLine] = `${node.lines[lastLine] ?? ""}.`;
  return true;
}

function appendCharacter(
  result: string,
  character: string,
  nodes: readonly latexLayoutTypes.LayoutNode[],
): string {
  if (character === "=" || character === "<" || character === ">") {
    return `${result.trimEnd()} ${character} `;
  }
  if (character === "&") return result;
  if (character === "~") return `${result} `;
  if (character === "." && appendToTrailingMatrix(result, nodes)) return result;
  return result + character;
}

function scriptCanUseLayout(scripts: ScriptValues): boolean {
  return ![scripts.sub, scripts.sup].some(
    (value) =>
      value !== undefined &&
      (value.includes("/") ||
        (!value.includes(LAYOUT_MARKER_START) &&
          Array.from(value).length > 1 &&
          !/[A-Z*∗]/u.test(value))),
  );
}

export default class LatexParser {
  readonly source: string;
  readonly layoutNodes: latexLayoutTypes.LayoutNode[];
  readonly display: boolean;
  position = 0;
  supported = true;
  private stackFractions = true;
  private scriptDepth = 0;

  constructor(source: string, layoutNodes: latexLayoutTypes.LayoutNode[], display: boolean) {
    this.source = source;
    this.layoutNodes = layoutNodes;
    this.display = display;
  }

  get stacksFractions(): boolean {
    return this.stackFractions;
  }

  render(): string | undefined {
    const rendered = this.parseSequence();
    if (!this.supported || this.position !== this.source.length) {
      return undefined;
    }
    return normalizeOutput(rendered);
  }

  pushLayout(node: latexLayoutTypes.LayoutNode): string {
    return layoutMarker(this.layoutNodes.push(node) - 1);
  }

  peek(offset = 0): string | undefined {
    return this.source[this.position + offset];
  }

  skipWhile(pattern: RegExp, from = this.position): number {
    let next = from;
    while (next < this.source.length && pattern.test(this.source[next] ?? "")) {
      next++;
    }
    return next;
  }

  parseSequence(endCharacter?: string): string {
    const hasEnd = endCharacter !== undefined && endCharacter !== "";
    let result = "";
    while (this.position < this.source.length) {
      const character = this.source.charAt(this.position);
      if (hasEnd && character === endCharacter) {
        this.position++;
        return result;
      }
      if (character === "}") {
        this.supported = false;
        return result;
      }
      result = this.parseSequenceStep(result, character);
    }
    if (hasEnd) {
      this.supported = false;
    }
    return result;
  }

  private parseSequenceStep(result: string, character: string): string {
    if (character === "{") {
      this.position++;
      return result + this.parseSequence("}");
    }
    if (character === "\\") {
      return appendCommand(result, parseCommand(this));
    }
    if (character === "^" || character === "_") {
      this.position++;
      const trimmed = result.trimEnd();
      return appendScript(trimmed, this.parseScripts(character));
    }
    if (/\s/u.test(character)) {
      this.position = this.skipWhile(/\s/u);
      return `${result} `;
    }
    this.position++;
    return appendCharacter(result, character, this.layoutNodes);
  }

  private parseScriptArgument(
    marker: ScriptMarker,
    scripts: ScriptValues,
    order: latexFormatTypes.ScriptKind[],
  ): void {
    const kind = marker === "_" ? "sub" : "sup";
    this.scriptDepth++;
    try {
      scripts[kind] = this.parseRequiredArgument(false);
    } finally {
      this.scriptDepth--;
    }
    order.push(kind);
  }

  private parseScripts(initialMarker: ScriptMarker): string {
    const scripts: ScriptValues = {};
    const order: latexFormatTypes.ScriptKind[] = [];
    this.parseScriptArgument(initialMarker, scripts, order);
    const nextPosition = this.skipWhile(/\s/u);
    const nextMarker = this.source[nextPosition];
    if ((nextMarker === "^" || nextMarker === "_") && nextMarker !== initialMarker) {
      this.position = nextPosition + 1;
      this.parseScriptArgument(nextMarker, scripts, order);
    }
    return this.renderScripts(scripts, order);
  }

  private renderScripts(
    scripts: ScriptValues,
    order: readonly latexFormatTypes.ScriptKind[],
  ): string {
    const unicode = {
      sub: scripts.sub === undefined ? undefined : formatUnicodeScript(scripts.sub, "sub"),
      sup: scripts.sup === undefined ? undefined : formatUnicodeScript(scripts.sup, "sup"),
    };
    const needsLayout =
      this.display &&
      scriptCanUseLayout(scripts) &&
      (this.scriptDepth > 0 ||
        (scripts.sub !== undefined && unicode.sub === undefined) ||
        (scripts.sup !== undefined && unicode.sup === undefined));
    if (!needsLayout) {
      return order.map((kind) => unicode[kind] ?? formatScript(scripts[kind] ?? "", kind)).join("");
    }
    return this.pushLayout({
      lower: scripts.sub === undefined ? undefined : normalizeOutput(scripts.sub),
      type: "script",
      upper: scripts.sup === undefined ? undefined : normalizeOutput(scripts.sup),
    });
  }

  parseRequiredArgument(stackFractions = true): string {
    const previousStackFractions = this.stackFractions;
    this.stackFractions = previousStackFractions && stackFractions;
    const value = this.parseRequiredArgumentValue();
    this.stackFractions = previousStackFractions;
    return value;
  }

  private parseRequiredArgumentValue(): string {
    this.position = this.skipWhile(/\s/u);
    if (this.position >= this.source.length) {
      this.supported = false;
      return "";
    }
    if (this.source[this.position] === "{") {
      this.position++;
      return this.parseSequence("}");
    }
    if (this.source[this.position] === "\\") {
      return parseCommand(this);
    }
    const value = this.source[this.position] ?? "";
    this.position++;
    return value;
  }

  parseOptionalArgument(): string | undefined {
    this.position = this.skipWhile(/[ \t]/u);
    if (this.source[this.position] !== "[") {
      return undefined;
    }
    const end = this.source.indexOf("]", this.position + 1);
    if (end < 0) {
      this.supported = false;
      return undefined;
    }
    const value = this.source.slice(this.position + 1, end);
    this.position = end + 1;
    return this.renderNested(value);
  }

  readRawGroup(): string | undefined {
    this.position = this.skipWhile(/[ \t]/u);
    if (this.source[this.position] !== "{") {
      this.supported = false;
      return undefined;
    }

    const start = ++this.position;
    let depth = 1;
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (character === "\\") {
        this.position += 2;
        continue;
      }
      if (character === "{") depth++;
      if (character === "}") depth--;
      if (depth === 0) {
        const value = this.source.slice(start, this.position);
        this.position++;
        return value;
      }
      this.position++;
    }
    this.supported = false;
    return undefined;
  }

  renderNested(source: string, stackFractions = true): string {
    const rendered = new LatexParser(
      source,
      this.layoutNodes,
      this.display && stackFractions,
    ).render();
    if (rendered === undefined) {
      this.supported = false;
      return source;
    }
    return rendered;
  }
}
