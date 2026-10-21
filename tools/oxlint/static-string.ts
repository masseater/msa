import type { Context, Definition, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Bounds = { readonly prefix: string; readonly suffix: string };
type ConstDefinition = Definition & { readonly node: ESTree.VariableDeclarator };

const WRAPPERS: ReadonlySet<string> = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const OPEN: Bounds = { prefix: "", suffix: "" };

const wrapped = (node: flowTypes.Node): flowTypes.Node | undefined =>
  WRAPPERS.has(node.type) && "expression" in node ? (node.expression as flowTypes.Node) : undefined;

const literalText = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

const joinAll = (parts: readonly (string | undefined)[]): string | undefined =>
  parts.every((part) => part !== undefined) ? parts.join("") : undefined;

const cookedAt = (node: ESTree.TemplateLiteral, index: number): string =>
  node.quasis.at(index)?.value.cooked ?? "";

const templateParts = (
  node: ESTree.TemplateLiteral,
  fold: (node: flowTypes.MaybeNode) => string | undefined,
): readonly (string | undefined)[] =>
  node.quasis.flatMap((quasi, index) => {
    const expression = node.expressions[index];
    const cooked = quasi.value.cooked ?? undefined;
    return expression === undefined ? [cooked] : [cooked, fold(expression)];
  });

const isConcat = (node: flowTypes.Node): node is ESTree.BinaryExpression =>
  node.type === "BinaryExpression" && node.operator === "+";

const isSymbolIdentifier = (node: flowTypes.Node): boolean =>
  node.type === "Identifier" && node.name === "Symbol";

const isSymbolCallee = (node: flowTypes.Node): boolean =>
  isSymbolIdentifier(node) || (node.type === "MemberExpression" && isSymbolIdentifier(node.object));

const declarationKind = (definition: Definition | undefined): string | undefined =>
  definition?.parent?.type === "VariableDeclaration" ? definition.parent.kind : undefined;

const isConstDefinition = (definition: Definition | undefined): definition is ConstDefinition =>
  declarationKind(definition) === "const" && definition?.node.type === "VariableDeclarator";

const fitsBounds = (bounds: Bounds, target: string): boolean =>
  bounds.prefix.length + bounds.suffix.length <= target.length &&
  target.startsWith(bounds.prefix) &&
  target.endsWith(bounds.suffix);

class StaticString {
  readonly #active = new Set<flowTypes.Node>();
  readonly #context: Context;

  constructor(context: Context) {
    this.#context = context;
  }

  fold(node: flowTypes.MaybeNode): string | undefined {
    return this.#guarded(node, undefined, (current) => this.#foldNode(current));
  }

  mayEqual(node: flowTypes.MaybeNode, target: string): boolean {
    const text = this.fold(node);
    if (text !== undefined) return text === target;
    return !this.#isSymbol(node) && fitsBounds(this.#bounds(node), target);
  }

  #foldNode(node: flowTypes.Node): string | undefined {
    if (node.type === "Literal") return literalText(node.value);
    if (node.type === "TemplateLiteral")
      return joinAll(templateParts(node, (part) => this.fold(part)));
    if (isConcat(node)) return joinAll([this.fold(node.left), this.fold(node.right)]);
    return this.fold(this.#inner(node));
  }

  #guarded<A>(node: flowTypes.MaybeNode, fallback: A, evaluate: (node: flowTypes.Node) => A): A {
    if (node === null || node === undefined || this.#active.has(node)) return fallback;
    this.#active.add(node);
    const result = evaluate(node);
    this.#active.delete(node);
    return result;
  }

  #soleDefinition(node: flowTypes.Node): Definition | undefined {
    const definitions = scopeLookup.variableOf(this.#context, node)?.defs ?? [];
    return definitions.length === 1 ? definitions[0] : undefined;
  }

  #constInitializer(node: flowTypes.Node): flowTypes.Node | undefined {
    const definition = this.#soleDefinition(node);
    return isConstDefinition(definition) ? (definition.node.init ?? undefined) : undefined;
  }

  #inner(node: flowTypes.Node): flowTypes.Node | undefined {
    return node.type === "Identifier" ? this.#constInitializer(node) : wrapped(node);
  }

  #isSymbol(node: flowTypes.MaybeNode): boolean {
    return this.#guarded(node, false, (current) =>
      current.type === "CallExpression"
        ? isSymbolCallee(current.callee)
        : isSymbolCallee(current) || this.#isSymbol(this.#inner(current)),
    );
  }

  #bounds(node: flowTypes.MaybeNode): Bounds {
    return this.#guarded(node, OPEN, (current) => this.#boundsOf(current));
  }

  #boundsOf(node: flowTypes.Node): Bounds {
    if (node.type === "TemplateLiteral")
      return { prefix: cookedAt(node, 0), suffix: cookedAt(node, -1) };
    if (isConcat(node)) return this.#concatBounds(node);
    return this.#bounds(this.#inner(node));
  }

  #concatBounds(node: ESTree.BinaryExpression): Bounds {
    const [leftText, rightText] = [this.fold(node.left), this.fold(node.right)];
    const [left, right] = [this.#bounds(node.left), this.#bounds(node.right)];
    return {
      prefix: leftText === undefined ? left.prefix : leftText + right.prefix,
      suffix: rightText === undefined ? right.suffix : left.suffix + rightText,
    };
  }
}

export default StaticString;
