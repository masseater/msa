import { dual } from "effect/Function";

import latexFormat from "./latex-format.ts";
import type latexOperatorTypes from "./latex-operator.types.ts";
import type latexParserTypes from "./latex-parser.types.ts";

const { formatScript, normalizeOutput } = latexFormat;

interface OperatorLimits {
  lower?: string | undefined;
  upper?: string | undefined;
}

function readLimitsModifier(parser: latexParserTypes.LatexParser, displayLimits: boolean): boolean {
  const modifierPosition = parser.skipWhile(/[ \t]/u);
  const modifier = /^\\(limits|nolimits)(?![A-Za-z])/u.exec(parser.source.slice(modifierPosition));
  if (modifier === null) return displayLimits;
  parser.position = modifierPosition + modifier[0].length;
  return modifier[1] === "limits";
}

function readOperatorLimits(parser: latexParserTypes.LatexParser): OperatorLimits {
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

const parseOperator: {
  (
    parser: latexParserTypes.LatexParser,
    operator: string,
    style: latexOperatorTypes.OperatorStyle,
  ): string;
  (
    operator: string,
    style: latexOperatorTypes.OperatorStyle,
  ): (parser: latexParserTypes.LatexParser) => string;
} = dual(
  3,
  (
    parser: latexParserTypes.LatexParser,
    operator: string,
    style: latexOperatorTypes.OperatorStyle,
  ): string => {
    const useDisplayLimits = readLimitsModifier(parser, style.displayLimits);
    const { lower, upper } = readOperatorLimits(parser);

    if (parser.display && useDisplayLimits && (lower !== undefined || upper !== undefined)) {
      return parser.pushLayout({ lower, operator, type: "operator", upper });
    }

    let rendered = operator;
    if (lower !== undefined) {
      rendered += style.inlineLowerStyle === "bracket" ? `[${lower}]` : formatScript(lower, "sub");
    }
    if (upper !== undefined) {
      rendered += formatScript(upper, "sup");
    }
    return style.spaced === true ? ` ${rendered} ` : rendered;
  },
);

const latexOperator = {
  parseOperator,
};

export default latexOperator;
