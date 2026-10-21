import type { Context, ESTree, Variable } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";
import StaticString from "./static-string.ts";

type Step = "stop" | "up" | "use";
type Handler<K extends string> = (child: flowTypes.Node, parent: flowTypes.Node, kind: K) => void;

const FIXED_STEPS: ReadonlyMap<string, Step> = new Map([
  ...[
    "AwaitExpression",
    "ChainExpression",
    "LogicalExpression",
    "ParenthesizedExpression",
    "TSAsExpression",
    "TSInstantiationExpression",
    "TSNonNullExpression",
    "TSSatisfiesExpression",
    "TSTypeAssertion",
  ].map((type) => [type, "up"] as const),
  ...[
    "BinaryExpression",
    "ExpressionStatement",
    "IfStatement",
    "TSQualifiedName",
    "TSTypeQuery",
    "UnaryExpression",
  ].map((type) => [type, "stop"] as const),
]);

const CONTAINER_STEPS: Readonly<
  Record<string, (parent: flowTypes.Node, child: flowTypes.Node) => Step>
> = {
  ConditionalExpression: (parent, child) =>
    (parent as ESTree.ConditionalExpression).test === child ? "stop" : "up",
  SequenceExpression: (parent, child) =>
    (parent as ESTree.SequenceExpression).expressions.at(-1) === child ? "up" : "stop",
};

const ESCAPES: ReadonlySet<string> = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "ExportDefaultDeclaration",
  "ExportSpecifier",
  "ReturnStatement",
  "YieldExpression",
]);

const stepOf = (parent: flowTypes.Node, child: flowTypes.Node): Step => {
  const fixed = FIXED_STEPS.get(parent.type);
  if (fixed !== undefined) return fixed;
  return CONTAINER_STEPS[parent.type]?.(parent, child) ?? "use";
};

const named = (name: string): flowTypes.Key => ({ mayBe: (target) => target === name, name });

const isStaticIdentifier = (computed: boolean, key: flowTypes.Node): key is ESTree.IdentifierName =>
  !computed && key.type === "Identifier";

class ValueFlow<K extends string> {
  readonly #context: Context;
  readonly #flow: flowTypes.Flow<K>;
  readonly #handlers: Readonly<Record<string, Handler<K>>>;
  readonly #binders: Readonly<Record<string, Handler<K>>>;
  readonly #strings: StaticString;
  readonly #seen = new Map<Variable, Set<K>>();

  constructor(options: { readonly context: Context; readonly flow: flowTypes.Flow<K> }) {
    this.#context = options.context;
    this.#flow = options.flow;
    this.#strings = new StaticString(options.context);
    this.#handlers = {
      AssignmentExpression: (child, parent, kind) => this.#onAssign(child, parent, kind),
      CallExpression: (child, parent, kind) => this.#onCall(child, parent, kind),
      MemberExpression: (child, parent, kind) => this.#onMember(child, parent, kind),
      NewExpression: (child, parent, kind) => this.#onCall(child, parent, kind),
      Property: (child, parent, kind) => this.#onProperty(child, parent, kind),
      VariableDeclarator: (_child, parent, kind) =>
        this.bind((parent as ESTree.VariableDeclarator).id, kind),
    };
    this.#binders = {
      AssignmentPattern: (pattern, _parent, kind) =>
        this.bind((pattern as ESTree.AssignmentPattern).left, kind),
      Identifier: (pattern, _parent, kind) =>
        this.#taint(scopeLookup.variableOf(this.#context, pattern), kind),
      ObjectPattern: (pattern, _parent, kind) => this.#bindProperties(pattern, kind),
    };
  }

  key(node: flowTypes.MaybeNode): flowTypes.Key {
    const name = this.#strings.fold(node);
    return { mayBe: (target) => name === target || this.#strings.mayEqual(node, target), name };
  }

  track(node: flowTypes.Node, kind: K): void {
    const parent = node.parent as flowTypes.Node | null;
    if (parent !== null) this.#follow(node, parent, kind);
  }

  bind(pattern: flowTypes.Node, kind: K): void {
    const binder = this.#binders[pattern.type];
    if (binder === undefined) this.#flow.unknown(pattern);
    else binder(pattern, pattern, kind);
  }

  #follow(node: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    const step = stepOf(parent, node);
    if (step === "up") this.track(parent, kind);
    else if (step === "use") this.#use(node, parent, kind);
  }

  #use(child: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    const handler = this.#handlers[parent.type];
    if (handler === undefined) this.#escape(child, parent, kind);
    else handler(child, parent, kind);
  }

  #escape(child: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    this.#apply(ESCAPES.has(parent.type) ? this.#flow.escape(kind) : "unknown", child);
  }

  #apply(outcome: flowTypes.Outcome<K>, node: flowTypes.Node): void {
    if (outcome === "unknown") this.#flow.unknown(node);
    else if (outcome !== "ok") this.track(node, outcome);
  }

  #bindOutcome(outcome: flowTypes.Outcome<K>, pattern: flowTypes.Node): void {
    if (outcome === "unknown") this.#flow.unknown(pattern);
    else if (outcome !== "ok") this.bind(pattern, outcome);
  }

  #taint(variable: Variable | undefined, kind: K): void {
    if (variable !== undefined && this.#mark(variable, kind)) this.#trackReads(variable, kind);
  }

  #mark(variable: Variable, kind: K): boolean {
    const kinds = this.#seen.get(variable) ?? new Set<K>();
    this.#seen.set(variable, kinds);
    const fresh = !kinds.has(kind);
    kinds.add(kind);
    return fresh;
  }

  #trackReads(variable: Variable, kind: K): void {
    for (const reference of variable.references.filter((candidate) => candidate.isRead()))
      this.track(reference.identifier, kind);
  }

  #bindProperties(pattern: flowTypes.Node, kind: K): void {
    for (const property of (pattern as { readonly properties: readonly flowTypes.Node[] })
      .properties)
      this.#bindProperty(property, kind);
  }

  #bindProperty(property: flowTypes.Node, kind: K): void {
    if (property.type === "RestElement") this.bind(property.argument, kind);
    else if (property.type === "Property")
      this.#bindOutcome(this.#flow.member(kind, this.#propertyKey(property)), property.value);
  }

  #propertyKey(property: {
    readonly computed: boolean;
    readonly key: flowTypes.Node;
  }): flowTypes.Key {
    const { computed, key } = property;
    return isStaticIdentifier(computed, key) ? named(key.name) : this.key(key);
  }

  #memberKey(member: ESTree.MemberExpression): flowTypes.Key {
    const { computed, property } = member;
    return isStaticIdentifier(computed, property) ? named(property.name) : this.key(property);
  }

  #onCall(child: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    const call = parent as ESTree.CallExpression | ESTree.NewExpression;
    if (call.callee === child) this.#apply(this.#flow.call(kind, call), call);
    else this.#onArgument(child, call, kind);
  }

  #onArgument(
    child: flowTypes.Node,
    call: ESTree.CallExpression | ESTree.NewExpression,
    kind: K,
  ): void {
    const index = call.arguments.indexOf(child as ESTree.Argument);
    this.#apply(this.#flow.argument(kind, call, index), child);
  }

  #onMember(child: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    const member = parent as ESTree.MemberExpression;
    if (member.object === child)
      this.#apply(this.#flow.member(kind, this.#memberKey(member)), member);
    else this.#flow.unknown(child);
  }

  #onAssign(child: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    const assignment = parent as ESTree.AssignmentExpression;
    if (assignment.right === child && assignment.operator === "=") this.bind(assignment.left, kind);
    else this.#flow.unknown(child);
  }

  #onProperty(child: flowTypes.Node, parent: flowTypes.Node, kind: K): void {
    const property = parent as ESTree.ObjectProperty;
    if (property.value === child && property.parent.type === "ObjectExpression")
      this.#apply(this.#flow.argument(kind, property, -1), child);
    else this.#flow.unknown(child);
  }
}

export default ValueFlow;
