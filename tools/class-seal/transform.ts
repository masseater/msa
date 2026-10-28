import MagicString from "magic-string";
import type { SourceMap } from "magic-string";
import { parseSync } from "vite-plus";

import classOrigin from "./origin.ts";

const RUNTIME = "__msaClassSeal";

const STANDALONE: ReadonlySet<string> = new Set(["src/extensions/codemode/worker"]);

const SHARED = `${RUNTIME}Tui`;

const SHARED_MODULE = "src/core/platform/node/class-seal-tui";

const TUI = "@msa/tui";

const IMPORT_SOURCES: ReadonlySet<string> = new Set([
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
  "ImportDeclaration",
  "ImportExpression",
]);

type Span = { readonly start: number; readonly end: number };

type ClassNode = Span & {
  readonly type: "ClassDeclaration" | "ClassExpression";
  readonly declare?: boolean;
  readonly superClass: Span | null;
  readonly body: Span;
};

type Sealed = { readonly code: string; readonly map: SourceMap };

type Found = { readonly node: ClassNode; readonly nested: boolean };

type Program = Parameters<typeof classOrigin.moduleOf>[0];

type Scope = ReturnType<typeof classOrigin.moduleOf>;

type Target = {
  readonly filename: string;
  readonly module: string;
  readonly runtime: string;
  readonly shared: string;
};

const isNode = (value: unknown): value is Span & { readonly type: string } =>
  typeof value === "object" && value !== null && "type" in value && "start" in value;

const childrenOf = (node: object): readonly unknown[] =>
  Object.values(node).flatMap((value: unknown) => (Array.isArray(value) ? value : [value]));

const isClass = (node: unknown): node is ClassNode =>
  isNode(node) &&
  (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
  (node as ClassNode).declare !== true;

const MODULE_LEVEL: ReadonlySet<string> = new Set([
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "ParenthesizedExpression",
  "Program",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "VariableDeclaration",
  "VariableDeclarator",
]);

type Pending = { readonly node: unknown; readonly nested: boolean };

const isInside = (nested: boolean, node: object): boolean =>
  nested || !isNode(node) || !MODULE_LEVEL.has(node.type);

const visit = (found: Found[], { nested, node }: Pending): readonly Pending[] => {
  if (typeof node !== "object" || node === null) return [];
  if (isClass(node)) found.push({ nested, node });
  const inside = isInside(nested, node);
  return childrenOf(node).map((child) => ({ nested: inside, node: child }));
};

const classesIn = (root: unknown): readonly Found[] => {
  const found: Found[] = [];
  const pending: Pending[] = [{ nested: false, node: root }];
  while (pending.length > 0) pending.push(...visit(found, pending.pop()!));
  return found;
};

const importOffset = (code: string): number => (code.startsWith("#!") ? code.indexOf("\n") + 1 : 0);

const parse = (code: string, filename: string) => {
  const parsed = parseSync(filename, code, { lang: filename.endsWith(".ts") ? "ts" : "js" });
  if (parsed.errors.length > 0) throw new Error(`${filename}: 構文を読めない`);
  return parsed.program;
};

const countClasses = (code: string, filename: string): number =>
  classesIn(parse(code, filename)).length;

const slice = (code: string, span: Span): string => code.slice(span.start, span.end);

type Module = {
  readonly code: string;
  readonly moduleName: string;
  readonly roots: string;
  readonly scope: Scope;
};

const verifyBase = (
  { code, roots, scope }: Module,
  { nested, node }: Found,
): readonly [string, string] | undefined => {
  if (node.superClass === null) return undefined;
  const origin = classOrigin.originOf(scope, node.superClass as unknown as Program, nested);
  if (origin.kind === "reference")
    return [
      `${RUNTIME}.reference(`,
      `, [${origin.containers.map((span) => slice(code, span)).join(", ")}]${roots})`,
    ];
  if (origin.kind === "product")
    return [`${RUNTIME}.product(`, `, () => ${origin.probe(slice(code, origin.callee))}${roots})`];
  return [`${RUNTIME}.unknown(`, ")"];
};

const KIND_KEYS: ReadonlySet<string> = new Set(["exportKind", "importKind"]);

const isTypeOnly = (node: object): boolean =>
  Object.entries(node).some(([key, value]) => KIND_KEYS.has(key) && value === "type");

const isValueImport = (node: unknown): boolean =>
  isNode(node) && IMPORT_SOURCES.has(node.type) && !isTypeOnly(node);

const importsTui = (program: object): boolean =>
  childrenOf(program).some(
    (node) => isValueImport(node) && sourceOf(node).some((source) => specifierOf(source) === TUI),
  );

const sealClass =
  (edited: MagicString, module: Module) =>
  (found: Found): void => {
    const { node } = found;
    const { moduleName } = module;
    const wrap = verifyBase(module, found);
    if (wrap !== undefined && node.superClass !== null) {
      edited.appendLeft(node.superClass.start, wrap[0]);
      edited.prependRight(node.superClass.end, wrap[1]);
    }
    const based = String(wrap !== undefined);
    edited.appendLeft(node.body.start + 1, ` static { ${RUNTIME}.enter(this, ${based}); }`);
    edited.appendLeft(
      node.body.end - 1,
      ` static { ${RUNTIME}.seal(this, ${moduleName}, ${based}); }`,
    );
  };

const sharedOf = (program: object, { module, shared }: Target) =>
  module !== SHARED_MODULE && importsTui(program)
    ? { imported: `import ${SHARED} from ${JSON.stringify(shared)};`, roots: `, ${SHARED}` }
    : { imported: "", roots: "" };

const sealClasses = (code: string, target: Target): Sealed => {
  const { filename, module, runtime } = target;
  if (code.includes(RUNTIME))
    throw new Error(`${filename}: ${RUNTIME} は class の検査が使う名前なので、ソースに書かない`);
  const program = parse(code, filename);
  const scope = classOrigin.moduleOf(program as unknown as Program, filename);
  const edited = new MagicString(code);
  const { imported, roots } = sharedOf(program, target);
  classesIn(program).forEach(
    sealClass(edited, { code, moduleName: JSON.stringify(module), roots, scope }),
  );
  edited.appendLeft(
    importOffset(code),
    `import ${RUNTIME} from ${JSON.stringify(runtime)};${imported}`,
  );
  return {
    code: edited.toString(),
    map: edited.generateMap({ hires: true, includeContent: true, source: filename }),
  };
};

const sourceOf = (node: unknown): readonly unknown[] =>
  isNode(node) && IMPORT_SOURCES.has(node.type) && "source" in node ? [node.source] : [];

const importsIn = (root: unknown): readonly unknown[] => {
  const found: unknown[] = [];
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    found.push(...sourceOf(node));
    if (typeof node === "object" && node !== null) pending.push(...childrenOf(node));
  }
  return found;
};

const isLiteral = (node: unknown): node is Span & { readonly value: unknown } =>
  isNode(node) && node.type === "Literal" && "value" in node;

const specifierOf = (source: unknown): string | undefined =>
  isLiteral(source) && typeof source.value === "string" ? source.value : undefined;

const isPackageSource = (source: unknown): boolean =>
  source === null || !/^(?:\.|\/|file:)/u.test(specifierOf(source) ?? "./");

const assertStandalone = (code: string, filename: string): void => {
  const program = parse(code, filename);
  if (classesIn(program).length > 0)
    throw new Error(`${filename}: class の検査を掛けない入口に class を書かない`);
  if (!importsIn(program).every(isPackageSource))
    throw new Error(`${filename}: class の検査を掛けない入口から src の module を import しない`);
};

const sealModule = (code: string, target: Target): Sealed | undefined => {
  if (!STANDALONE.has(target.module)) return sealClasses(code, target);
  assertStandalone(code, target.filename);
  return undefined;
};

const relativeSpecifier = (from: string, to: string): string => {
  const fromParts = from.split("/").slice(0, -1);
  const toParts = to.split("/");
  const shared = fromParts.findIndex((part, index) => part !== toParts[index]);
  const common = shared === -1 ? fromParts.length : shared;
  const ups = fromParts.length - common;
  const rest = toParts.slice(common).join("/");
  return ups === 0 ? `./${rest}` : `${"../".repeat(ups)}${rest}`;
};

const moduleOf = (root: string, file: string): string =>
  file.slice(root.endsWith("/") ? root.length : root.length + 1).replace(/\.(?:ts|js)$/u, "");

const classSealTransform = {
  RUNTIME,
  SHARED,
  STANDALONE,
  countClasses,
  moduleOf,
  relativeSpecifier,
  sealClasses,
  sealModule,
};

export default classSealTransform;
