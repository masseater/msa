import {
  DISPLAY_LIMIT_SYMBOLS,
  FONT_SWITCH_COMMANDS,
  IGNORED_COMMANDS,
  LIMIT_OPERATORS,
  NAMED_OPERATORS,
  NEGATIVE_SPACE,
  NEGATIVE_SPACING_COMMANDS,
  PLAIN_WRAPPERS,
  RELATION_COMMANDS,
  SIZE_COMMANDS,
  SPACING_COMMANDS,
} from "./latex-command-sets.ts";
import { parseEnvironment } from "./latex-environments.ts";
import {
  formatFraction,
  formatRoot,
  formatScript,
  NAMED_OPERATOR_END,
  NAMED_OPERATOR_START,
  normalizeOutput,
} from "./latex-format.ts";
import { parseOperator } from "./latex-operator.ts";
import type { LatexParser } from "./latex-parser.ts";
import { SYMBOLS } from "./latex-symbols.ts";
import { ACCENTS, BLACKBOARD, NEGATED_SYMBOLS } from "./latex-tables.ts";

type CommandHandler = (parser: LatexParser, command: string) => string;
type CommandRule = readonly [(command: string) => boolean, CommandHandler];

const ESCAPED_CHARACTERS = new Set(["{", "}", "$", "%", "#", "_", "&"]);
const ROOT_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ["2", "√"],
  ["3", "∛"],
  ["4", "∜"],
]);

function oneOf(...commands: string[]): (command: string) => boolean {
  return (command) => commands.includes(command);
}

function fail(parser: LatexParser, value: string): string {
  parser.supported = false;
  return value;
}

function renderNot(parser: LatexParser): string {
  const value = parser.parseRequiredArgument(false).trim();
  const negated = NEGATED_SYMBOLS[value];
  if (negated !== undefined) {
    return ` ${negated} `;
  }
  const characters = Array.from(value);
  if (characters.length === 0) {
    return fail(parser, "");
  }
  return ` ${characters[0]}̸${characters.slice(1).join("")} `;
}

function renderSymbol(parser: LatexParser, command: string): string {
  const symbol = SYMBOLS[command] ?? "";
  if (DISPLAY_LIMIT_SYMBOLS.has(command)) {
    return parseOperator(parser, symbol, { inlineLowerStyle: "script", displayLimits: true });
  }
  return command === "cdot" || command === "times" || RELATION_COMMANDS.has(command)
    ? ` ${symbol} `
    : symbol;
}

function renderFraction(parser: LatexParser, command: string): string {
  const shouldStack = parser.display && parser.stacksFractions && command !== "tfrac";
  const numerator = parser.parseRequiredArgument(!shouldStack);
  const denominator = parser.parseRequiredArgument(!shouldStack);
  if (shouldStack) {
    return parser.pushLayout({
      type: "fraction",
      numerator: normalizeOutput(numerator),
      denominator: normalizeOutput(denominator),
    });
  }
  return formatFraction(numerator, denominator);
}

function renderSqrt(parser: LatexParser): string {
  const degree = parser.parseOptionalArgument()?.trim();
  const value = parser.parseRequiredArgument();
  const symbol = ROOT_SYMBOLS.get(degree ?? "2");
  if (symbol !== undefined) {
    return formatRoot(value, symbol);
  }
  return `${formatScript(degree ?? "", "sup")}${formatRoot(value, "√")}`;
}

function renderAccent(parser: LatexParser, command: string): string {
  const value = parser.parseRequiredArgument();
  return Array.from(value).length === 1 ? `${value}${ACCENTS[command]}` : `${command}(${value})`;
}

function renderOperatorName(parser: LatexParser): string {
  const starred = parser.peek() === "*";
  if (starred) {
    parser.position++;
  }
  const operator = normalizeOutput(parser.parseRequiredArgument()).trim();
  return parseOperator(parser, operator, {
    inlineLowerStyle: "bracket",
    displayLimits: starred,
    spaced: true,
  });
}

function renderModulo(parser: LatexParser, command: string): string {
  const value = parser.parseRequiredArgument().trim();
  return command === "pmod" ? ` (mod ${value})` : ` (${value})`;
}

function renderStacked(parser: LatexParser, command: string): string {
  const script = parser.parseRequiredArgument();
  const value = parser.parseRequiredArgument().trim();
  return `${value}${formatScript(script, command === "underset" ? "sub" : "sup")}`;
}

function renderPlainWrapper(parser: LatexParser, command: string): string {
  const value = parser.parseRequiredArgument();
  return command.startsWith("text") || command === "mbox" ? value : value.trim();
}

const COMMAND_RULES: readonly CommandRule[] = [
  [oneOf("\\"), () => "\n"],
  [(command) => SPACING_COMMANDS.has(command), () => " "],
  [(command) => NEGATIVE_SPACING_COMMANDS.has(command), () => NEGATIVE_SPACE],
  [
    (command) => FONT_SWITCH_COMMANDS.has(command),
    (parser) => {
      parser.position = parser.skipWhile(/\s/u);
      return "";
    },
  ],
  [(command) => IGNORED_COMMANDS.has(command), () => ""],
  [(command) => ESCAPED_CHARACTERS.has(command), (_parser, command) => command],
  [oneOf("|"), () => "‖"],
  [oneOf("not"), renderNot],
  [
    (command) => LIMIT_OPERATORS.has(command),
    (parser, command) =>
      parseOperator(parser, command, {
        inlineLowerStyle: "bracket",
        displayLimits: true,
        spaced: true,
      }),
  ],
  [(command) => SYMBOLS[command] !== undefined, renderSymbol],
  [
    (command) => NAMED_OPERATORS.has(command),
    (_parser, command) => `${NAMED_OPERATOR_START}${command}${NAMED_OPERATOR_END}`,
  ],
  [(command) => SIZE_COMMANDS.has(command), () => ""],
  [
    oneOf("left", "middle", "right"),
    (parser) => {
      if (parser.peek() === ".") {
        parser.position++;
      }
      return "";
    },
  ],
  [oneOf("frac", "dfrac", "tfrac"), renderFraction],
  [oneOf("sqrt"), renderSqrt],
  [oneOf("boxed", "fbox"), (parser) => `[${parser.parseRequiredArgument().trim()}]`],
  [
    oneOf("binom", "dbinom", "tbinom"),
    (parser) => `(${parser.parseRequiredArgument()} choose ${parser.parseRequiredArgument()})`,
  ],
  [(command) => ACCENTS[command] !== undefined, renderAccent],
  [
    oneOf("mathbb"),
    (parser) =>
      Array.from(
        parser.parseRequiredArgument(),
        (character) => BLACKBOARD[character] ?? character,
      ).join(""),
  ],
  [oneOf("operatorname"), renderOperatorName],
  [oneOf("mod", "bmod"), () => " mod "],
  [oneOf("pmod", "pod"), renderModulo],
  [oneOf("overset", "stackrel", "underset"), renderStacked],
  [(command) => PLAIN_WRAPPERS.has(command), renderPlainWrapper],
  [oneOf("begin"), parseEnvironment],
  [oneOf("end"), (parser) => fail(parser, "")],
];

function readCommandName(parser: LatexParser, first: string): string {
  if (/[A-Za-z]/u.test(first)) {
    const start = parser.position;
    parser.position = parser.skipWhile(/[A-Za-z]/u);
    return parser.source.slice(start, parser.position);
  }
  parser.position++;
  return first;
}

export function parseCommand(parser: LatexParser): string {
  parser.position++;
  if (parser.position >= parser.source.length) {
    return fail(parser, "");
  }

  const first = parser.peek() ?? "";
  if (first === "\n" || first === "\r") {
    parser.position++;
    if (first === "\r" && parser.peek() === "\n") {
      parser.position++;
    }
    return " ";
  }

  const command = readCommandName(parser, first);
  const rule = COMMAND_RULES.find(([matches]) => matches(command));
  return rule === undefined ? fail(parser, `\\${command}`) : rule[1](parser, command);
}
