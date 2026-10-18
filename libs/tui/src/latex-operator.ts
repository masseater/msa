import { dual } from "effect/Function";

import { formatScript, normalizeOutput } from "./latex-format.ts";
import type { LatexParser } from "./latex-parser.ts";

export interface OperatorStyle {
  inlineLowerStyle: "bracket" | "script";
  displayLimits: boolean;
  spaced?: boolean;
}

interface OperatorLimits {
  lower?: string | undefined;
  upper?: string | undefined;
}

function readLimitsModifier(parser: LatexParser, displayLimits: boolean): boolean {
  const modifierPosition = parser.skipWhile(/[ \t]/u);
  const modifier = /^\\(limits|nolimits)(?![A-Za-z])/u.exec(parser.source.slice(modifierPosition));
  if (modifier === null) return displayLimits;
  parser.position = modifierPosition + modifier[0].length;
  return modifier[1] === "limits";
}

function readOperatorLimits(parser: LatexParser): OperatorLimits {
  const limits: OperatorLimits = {};
  for (;;) {
    const scriptPosition = parser.skipWhile(/[ \t]/u);
    const kind = parser.source[scriptPosition];
    if (kind !== "_" && kind !== "^") {
      return limits;
    }
    parser.position = scriptPosition + 1;
    const value = normalizeOutput(parser.parseRequiredArgument(false)).replaceAll(" ", "");
    const key = kind === "_" ? "lower" : "upper";
    if (limits[key] !== undefined) {
      parser.supported = false;
    }
    limits[key] = value;
  }
}

export const parseOperator: {
  (parser: LatexParser, operator: string, style: OperatorStyle): string;
  (operator: string, style: OperatorStyle): (parser: LatexParser) => string;
} = dual(3, (parser: LatexParser, operator: string, style: OperatorStyle): string => {
  const useDisplayLimits = readLimitsModifier(parser, style.displayLimits);
  const { lower, upper } = readOperatorLimits(parser);

  if (parser.display && useDisplayLimits && (lower !== undefined || upper !== undefined)) {
    return parser.pushLayout({ type: "operator", operator, lower, upper });
  }

  let rendered = operator;
  if (lower !== undefined) {
    rendered += style.inlineLowerStyle === "bracket" ? `[${lower}]` : formatScript(lower, "sub");
  }
  if (upper !== undefined) {
    rendered += formatScript(upper, "sup");
  }
  return style.spaced === true ? ` ${rendered} ` : rendered;
});
