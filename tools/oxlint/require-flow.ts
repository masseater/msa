import type { Context, ESTree } from "vite-plus/lint/plugins";

import fileUrl from "./file-url.ts";
import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";
import StaticString from "./static-string.ts";
import ValueFlow from "./value-flow.ts";

type Kind = "loader" | "module" | "factory";
type Outcome = flowTypes.Outcome<Kind>;

const MODULE_SPECIFIERS: ReadonlySet<string> = new Set(["module", "node:module"]);
const INDIRECT_CALLS: readonly string[] = ["apply", "bind", "call"];
const FACTORY = "createRequire";
const LOADER_METHODS: ReadonlySet<string> = new Set(["_load", "require"]);

const MODULE_MEMBERS: ReadonlyMap<string, Kind> = new Map([
  ["Module", "module"],
  ["_load", "loader"],
  ["constructor", "module"],
  ["createRequire", "factory"],
  ["default", "module"],
  ["prototype", "module"],
  ["require", "loader"],
]);

const moduleBase = (specifier: string): string =>
  specifier.replace(/^node:/u, "").split("/")[0] ?? specifier;

const optionModules = (context: Context): ReadonlySet<string> => {
  const [options] = context.options as readonly ({ modules?: readonly string[] } | undefined)[];
  return new Set(options?.modules ?? []);
};

const anyName = (key: flowTypes.Key, names: readonly string[]): boolean =>
  names.some((name) => key.mayBe(name));

const functionMember = (key: flowTypes.Key): Outcome =>
  anyName(key, INDIRECT_CALLS) ? "unknown" : "ok";

const moduleMemberNamed = (name: string): Outcome => MODULE_MEMBERS.get(name) ?? "ok";

const moduleMember = (key: flowTypes.Key): Outcome => {
  if (key.name !== undefined) return moduleMemberNamed(key.name);
  return anyName(key, [...MODULE_MEMBERS.keys()]) ? "unknown" : "ok";
};

const isKind = (outcome: Outcome): outcome is Kind => outcome !== "ok" && outcome !== "unknown";

const exportedLocalName = (specifier: ESTree.ExportSpecifier): string | undefined =>
  specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;

const importedName = (specifier: ESTree.ImportDeclarationSpecifier): string =>
  specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : "default";

class RequireFlow {
  readonly #context: Context;
  readonly #modules: ReadonlySet<string>;
  readonly #report: flowTypes.Reporters;
  readonly #strings: StaticString;
  readonly #values: ValueFlow<Kind>;

  constructor(options: { readonly context: Context; readonly report: flowTypes.Reporters }) {
    this.#context = options.context;
    this.#report = options.report;
    this.#modules = optionModules(options.context);
    this.#strings = new StaticString(options.context);
    this.#values = new ValueFlow<Kind>({
      context: options.context,
      flow: {
        argument: () => "unknown",
        call: (kind, call) => this.#callOutcome(kind, call),
        escape: () => "unknown",
        member: (kind, key) => (kind === "module" ? moduleMember(key) : functionMember(key)),
        unknown: options.report.unknown,
      },
    });
  }

  checkSpecifier(node: flowTypes.MaybeNode, at: flowTypes.Node): void {
    this.#specifier(node, at);
  }

  #specifier(node: flowTypes.MaybeNode, at: flowTypes.Node): Outcome {
    return this.#isFileUrl(node) ? "ok" : this.#namedSpecifier(node, at);
  }

  #namedSpecifier(node: flowTypes.MaybeNode, at: flowTypes.Node): Outcome {
    const specifier = this.#strings.fold(node);
    if (specifier === undefined) return "unknown";
    if (this.#modules.has(moduleBase(specifier))) this.#report.restricted(at);
    return MODULE_SPECIFIERS.has(specifier) ? "module" : "ok";
  }

  #isFileUrl(node: flowTypes.MaybeNode): boolean {
    return node !== null && node !== undefined && fileUrl.isFileUrl(this.#context, node);
  }

  fromImport(node: ESTree.ImportDeclaration): void {
    if (MODULE_SPECIFIERS.has(node.source.value))
      for (const specifier of node.specifiers) this.#bindImported(specifier);
  }

  fromReExport(node: ESTree.ExportAllDeclaration | ESTree.ExportNamedDeclaration): void {
    if (node.source === null) return;
    if (this.#specifier(node.source, node) !== "module") return;
    if (node.type === "ExportAllDeclaration") this.#report.unknown(node);
    else this.#reportModuleMembers(node.specifiers);
  }

  #reportModuleMembers(specifiers: ESTree.ExportNamedDeclaration["specifiers"]): void {
    for (const specifier of specifiers)
      if (MODULE_MEMBERS.has(exportedLocalName(specifier) ?? "")) this.#report.unknown(specifier);
  }

  fromGlobals(): void {
    for (const identifier of scopeLookup.globalReferences(this.#context, "require"))
      this.#values.track(identifier, "loader");
    for (const identifier of scopeLookup.globalReferences(this.#context, "module"))
      this.#values.track(identifier, "module");
  }

  fromMemberCall(node: ESTree.CallExpression): void {
    if (LOADER_METHODS.has(scopeLookup.staticMemberName(node.callee) ?? ""))
      this.#reportUnknown(this.#specifier(node.arguments[0], node), node);
  }

  fromDynamicImport(node: ESTree.ImportExpression): void {
    this.#reportUnknown(this.#specifier(node.source, node), node);
  }

  fromFactoryName(node: ESTree.MemberExpression | ESTree.BindingProperty): void {
    if (this.#nameOf(node) === FACTORY) this.#trackFactory(node);
  }

  #reportUnknown(outcome: Outcome, node: flowTypes.Node): void {
    if (outcome === "unknown") this.#report.unknown(node);
  }

  #bindImported(specifier: ESTree.ImportDeclarationSpecifier): void {
    const outcome = moduleMemberNamed(importedName(specifier));
    if (isKind(outcome)) this.#values.bind(specifier.local, outcome);
  }

  #nameOf(node: ESTree.MemberExpression | ESTree.BindingProperty): string | undefined {
    const key = node.type === "MemberExpression" ? node.property : node.key;
    return !node.computed && key.type === "Identifier" ? key.name : this.#strings.fold(key);
  }

  #trackFactory(node: ESTree.MemberExpression | ESTree.BindingProperty): void {
    if (node.type === "MemberExpression") this.#values.track(node, "factory");
    else if (node.parent.type === "ObjectPattern") this.#values.bind(node.value, "factory");
  }

  #callOutcome(kind: Kind, call: ESTree.CallExpression | ESTree.NewExpression): Outcome {
    if (kind === "factory") return "loader";
    return kind === "loader" ? this.#specifier(call.arguments[0], call) : "ok";
  }
}

export default RequireFlow;
