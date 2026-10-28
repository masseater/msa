import lintConfig from "../../lint.config.ts";
import classFactories from "../oxlint/class-factories.ts";

const { builtinModuleBases, workspacePackages } = lintConfig;

type Span = { readonly start: number; readonly end: number };

type AstNode = Span & { readonly type: string } & Readonly<Record<string, unknown>>;

type Origin =
  | { readonly kind: "reference"; readonly containers: readonly Span[] }
  | { readonly kind: "product"; readonly probe: (callee: string) => string; readonly callee: Span }
  | { readonly kind: "unknown" };

type Imported = { readonly name: string | undefined; readonly source: string };

type Module = {
  readonly imports: ReadonlyMap<string, Imported>;
  readonly shadowed: ReadonlySet<string>;
};

type Path = { readonly root: AstNode; readonly keys: readonly string[]; readonly spans: Span[] };

const TRANSPARENT: ReadonlySet<string> = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const BINDERS: ReadonlySet<string> = new Set([
  "ArrowFunctionExpression",
  "CatchClause",
  "ClassDeclaration",
  "ClassExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "VariableDeclarator",
]);

const UNKNOWN: Origin = { kind: "unknown" };

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && "type" in value && "start" in value;

const field = (node: AstNode, name: string): AstNode | undefined => {
  const value = node[name];
  return isNode(value) ? value : undefined;
};

const list = (node: AstNode, name: string): readonly AstNode[] => {
  const value = node[name];
  return Array.isArray(value) ? value.filter(isNode) : [];
};

const text = (node: AstNode | undefined, name: string): string | undefined => {
  const value = node?.[name];
  return typeof value === "string" ? value : undefined;
};

const childrenOf = (node: AstNode): readonly AstNode[] =>
  Object.values(node).flatMap((value: unknown) =>
    (Array.isArray(value) ? value : [value]).filter(isNode),
  );

const unwrap = (node: AstNode): AstNode => {
  const inner = TRANSPARENT.has(node.type) ? field(node, "expression") : undefined;
  return inner === undefined ? node : unwrap(inner);
};

const PATTERN_CHILDREN: Readonly<
  Record<string, (node: AstNode) => readonly (AstNode | undefined)[]>
> = {
  ArrayPattern: (node) => list(node, "elements"),
  AssignmentPattern: (node) => [field(node, "left")],
  ObjectPattern: (node) =>
    list(node, "properties").map((property) =>
      property.type === "RestElement" ? property : field(property, "value"),
    ),
  RestElement: (node) => [field(node, "argument")],
  TSParameterProperty: (node) => [field(node, "parameter")],
};

const identifierName = (node: AstNode): string => text(node, "name") ?? "";

const patternChildren = (node: AstNode): readonly (AstNode | undefined)[] =>
  PATTERN_CHILDREN[node.type]?.(node) ?? [];

function patternNames(node: AstNode | undefined): readonly string[] {
  if (node === undefined) return [];
  if (node.type === "Identifier") return [identifierName(node)];
  return patternChildren(node).flatMap(patternNames);
}

const boundBy = (node: AstNode): readonly string[] =>
  BINDERS.has(node.type)
    ? [
        ...patternNames(field(node, "id")),
        ...patternNames(field(node, "param")),
        ...list(node, "params").flatMap(patternNames),
      ]
    : [];

type WorkspacePackage = (typeof workspacePackages)[number];

const isRelativeOrBuiltin = (source: string): boolean =>
  /^(?:[./#]|node:)/u.test(source) || builtinModuleBases.includes(source.split("/")[0] ?? source);

const deeper = (found: WorkspacePackage | undefined, candidate: WorkspacePackage) =>
  found === undefined || candidate.dir.length > found.dir.length ? candidate : found;

const ownerOf = (filename: string): WorkspacePackage | undefined =>
  workspacePackages
    .filter(({ dir }) => filename.startsWith(`${dir}/`))
    .reduce<WorkspacePackage | undefined>(deeper, undefined);

const matchesSpecifier = (source: string, pattern: string): boolean => {
  const [prefix, suffix] = pattern.split("*");
  return suffix === undefined
    ? source === pattern
    : source.startsWith(prefix ?? "") && source.endsWith(suffix);
};

const ownSpecifiers = (filename: string): readonly string[] => ownerOf(filename)?.specifiers ?? [];

const isPackageSource = (source: string, filename: string): boolean =>
  !isRelativeOrBuiltin(source) &&
  !ownSpecifiers(filename).some((pattern) => matchesSpecifier(source, pattern));

const importedName = (specifier: AstNode): string | undefined => {
  if (specifier.type === "ImportNamespaceSpecifier") return undefined;
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  const imported = field(specifier, "imported");
  return text(imported, "name") ?? text(imported, "value");
};

const importsOf = (program: AstNode, filename: string): Map<string, Imported> =>
  new Map(
    list(program, "body")
      .filter(
        (statement) =>
          statement.type === "ImportDeclaration" && text(statement, "importKind") !== "type",
      )
      .flatMap((statement) => {
        const source = text(field(statement, "source"), "value") ?? "";
        if (!isPackageSource(source, filename)) return [];
        return list(statement, "specifiers")
          .filter((specifier) => text(specifier, "importKind") !== "type")
          .map(
            (specifier) =>
              [
                text(field(specifier, "local"), "name") ?? "",
                { name: importedName(specifier), source },
              ] as const,
          );
      }),
  );

const moduleOf = (program: AstNode, filename: string): Module => {
  const shadowed = new Set<string>();
  const pending: AstNode[] = [program];
  while (pending.length > 0) {
    const node = pending.pop()!;
    for (const name of boundBy(node)) shadowed.add(name);
    pending.push(...childrenOf(node));
  }
  return { imports: importsOf(program, filename), shadowed };
};

const isStringLiteral = (node: AstNode | undefined): boolean =>
  node?.type === "Literal" || node?.type === "StringLiteral";

const memberKey = (node: AstNode): string | undefined => {
  const property = field(node, "property");
  if (node["computed"] !== true) return text(property, "name");
  return isStringLiteral(property) ? text(property, "value") : undefined;
};

const extended = (inner: Path | undefined, key: string, object: AstNode): Path | undefined =>
  inner === undefined
    ? undefined
    : { keys: [...inner.keys, key], root: inner.root, spans: [...inner.spans, object] };

const memberPathOf = (value: AstNode): Path | undefined => {
  const object = field(value, "object");
  const key = value.type === "MemberExpression" ? memberKey(value) : undefined;
  return object === undefined || key === undefined
    ? undefined
    : extended(pathOf(object), key, object);
};

function pathOf(node: AstNode): Path | undefined {
  const value = unwrap(node);
  return value.type === "Identifier" ? { keys: [], root: value, spans: [] } : memberPathOf(value);
}

const importOf = (module: Module, path: Path, nested: boolean): Imported | undefined => {
  const name = text(path.root, "name") ?? "";
  return nested && module.shadowed.has(name) ? undefined : module.imports.get(name);
};

const innermostCallee = (node: AstNode): AstNode => {
  const value = unwrap(node);
  const callee = value.type === "CallExpression" ? field(value, "callee") : undefined;
  return callee === undefined ? value : innermostCallee(callee);
};

type Resolved = { readonly imported: Imported; readonly path: Path };

const resolve = (module: Module, node: AstNode, nested: boolean): Resolved | undefined => {
  const path = pathOf(node);
  const imported = path === undefined ? undefined : importOf(module, path, nested);
  return path === undefined || imported === undefined ? undefined : { imported, path };
};

const factoryOf = ({ imported, path }: Resolved) =>
  classFactories.get(
    [imported.source, imported.name, ...path.keys].filter((part) => part !== undefined).join("/"),
  );

const productOf = (module: Module, call: AstNode, nested: boolean): Origin => {
  const callee = innermostCallee(call);
  const resolved = resolve(module, callee, nested);
  const probe = resolved === undefined ? undefined : factoryOf(resolved);
  return probe === undefined ? UNKNOWN : { callee, kind: "product", probe };
};

const referenceOf = (module: Module, node: AstNode, nested: boolean): Origin => {
  const resolved = resolve(module, node, nested);
  if (resolved === undefined) return UNKNOWN;
  const { imported, path } = resolved;
  return {
    containers: imported.name === undefined ? path.spans.slice(1) : path.spans,
    kind: "reference",
  };
};

const originOf = (module: Module, superClass: AstNode, nested: boolean): Origin => {
  const value = unwrap(superClass);
  return value.type === "CallExpression"
    ? productOf(module, value, nested)
    : referenceOf(module, value, nested);
};

const classOrigin = { moduleOf, originOf };

export default classOrigin;
