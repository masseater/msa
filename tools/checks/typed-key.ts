import { TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";

const UNSAFE_NAMES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const OPEN_KEYS: readonly (readonly [number, string])[] = [
  [TypeFlags.Any, "any"],
  [TypeFlags.Unknown, "unknown"],
  [TypeFlags.String, "string"],
  [TypeFlags.TemplateLiteral, "template"],
  [TypeFlags.StringMapping, "string"],
];

const openKey = (type: Type): string | undefined =>
  OPEN_KEYS.find(([flag]) => (type.flags & flag) !== 0)?.[1];

function literalProblem(type: Type): string | undefined {
  return type.isStringLiteralType() && UNSAFE_NAMES.has(type.value) ? "unsafe-literal" : undefined;
}

function memberProblem(checker: Checker, type: Type): string | undefined {
  if (!type.isUnionType() && !type.isIntersectionType()) return undefined;
  return type
    .getTypes()
    .map((member) => keyProblem(checker, member))
    .find((problem) => problem !== undefined);
}

function constraintProblem(checker: Checker, type: Type): string | undefined {
  const constraint = checker.getBaseConstraintOfType(type);
  return constraint === undefined || constraint === type
    ? "type-parameter"
    : keyProblem(checker, constraint);
}

function closedProblem(checker: Checker, type: Type): string | undefined {
  if (type.isStringLiteralType()) return literalProblem(type);
  if (type.isTypeParameter()) return constraintProblem(checker, type);
  return memberProblem(checker, type);
}

function keyProblem(checker: Checker, type: Type | undefined): string | undefined {
  if (type === undefined) return "untyped";
  return openKey(type) ?? closedProblem(checker, type);
}

const typedKey = { keyProblem };

export default typedKey;
