import { types } from "node:util";

import { Context, Data, Schema } from "effect";

const LOCAL_BASE =
  "同じパッケージで定義したクラスを継承しない。責務ごとの部品をフィールドに持たせ、委譲して組む";

const PROBE_TAG = "msa/class-seal/probe";

type Defined = abstract new (...args: never[]) => unknown;

type Parents = ReadonlyMap<object, object | null>;

type Accepted = {
  readonly constructors: readonly object[];
  readonly fresh: boolean;
  readonly prototypes: readonly object[];
  readonly scope: Parents;
};

const FUNCTION_PROTOTYPE = Object.getPrototypeOf(() => undefined) as object;

const localClasses = new WeakSet<object>();
const accepted = new WeakMap<object, Accepted>();
const sealedByModule = new Map<string, number>();
const sharedParents = new Map<object, object | null>();
const scopes = new WeakMap<object, Parents>();

const refuse = (detail: string): never => {
  throw new TypeError(`${LOCAL_BASE}（${detail}）`);
};

const parentOf = (link: object): object | null => Object.getPrototypeOf(link) as object | null;

const lockLinks = (links: readonly object[]): void => {
  for (const link of links) if (link !== Object.prototype) Object.preventExtensions(link);
};

const matchesRecord = (link: object, scope: Parents = sharedParents): boolean => {
  const parents = scope.has(link) ? scope : sharedParents;
  return parents.has(link) && parentOf(link) === parents.get(link);
};

const assertLink = (link: object, where: string): void => {
  if (types.isProxy(link)) refuse(`${where}に Proxy がある`);
  if (localClasses.has(link)) refuse(`${where}に src の class がある`);
};

const chainOf = (start: object | null, fresh: boolean, scope: Parents): readonly object[] => {
  const links: object[] = [];
  for (let current = start; current !== null; current = parentOf(current)) {
    assertLink(current, "継承元の鎖");
    if (!(fresh && links.length === 0) && !matchesRecord(current, scope))
      refuse("継承元の外の段が、起動のときに記録した段でないか、親が記録と違う");
    links.push(current);
  }
  return links;
};

const recordShared = (root: unknown): void => {
  if ((typeof root !== "function" && typeof root !== "object") || root === null) return;
  const { prototype } = root as { readonly prototype?: unknown };
  const starts = typeof prototype === "object" && prototype !== null ? [root, prototype] : [root];
  for (const start of starts)
    for (let current: object | null = start; current !== null; current = parentOf(current)) {
      assertLink(current, "共有の基底の鎖");
      if (sharedParents.has(current)) break;
      sharedParents.set(current, parentOf(current));
    }
};

for (const root of [
  parentOf(Data.TaggedError(PROBE_TAG)),
  parentOf(Schema.TaggedError<object>()(PROBE_TAG, {})),
  parentOf(Context.Service()(PROBE_TAG)),
])
  recordShared(root);
lockLinks([...sharedParents.keys()]);

const constructorOf = (value: unknown): readonly [object, object] => {
  if (typeof value !== "function") return refuse("継承元が関数でない");
  if (types.isProxy(value)) return refuse("継承元が Proxy");
  const { prototype } = value as { readonly prototype?: unknown };
  if (typeof prototype !== "object" || prototype === null || types.isProxy(prototype))
    return refuse("継承元の prototype が object でない");
  return [value, prototype];
};

const rootLinks = (root: unknown): readonly object[] =>
  typeof root === "function" ? constructorOf(root) : [];

const buildScope = (roots: readonly unknown[]): Parents => {
  if (!Object.isFrozen(roots)) refuse("共有の基底の一覧が凍結されていない");
  const scope = new Map<object, object | null>();
  for (const link of roots.flatMap(rootLinks)) {
    assertLink(link, "共有の基底");
    scope.set(link, parentOf(link));
  }
  for (const parent of scope.values())
    if (parent !== null && !matchesRecord(parent, scope))
      refuse("共有の基底の親が、共有の基底でも起動のときに記録した段でもない");
  lockLinks([...scope.keys()]);
  return scope;
};

const scopeOf = (roots: readonly unknown[] | undefined): Parents => {
  if (roots === undefined) return sharedParents;
  const cached = scopes.get(roots);
  if (cached !== undefined) return cached;
  const scope = buildScope(roots);
  scopes.set(roots, scope);
  return scope;
};

const share = (roots: readonly unknown[]): void => {
  scopeOf(roots);
};

const accept = <T>(value: T, fresh: boolean, scope: Parents): T => {
  const [defined, prototype] = constructorOf(value);
  const record = {
    constructors: chainOf(defined, fresh, scope),
    fresh,
    prototypes: chainOf(prototype, fresh, scope),
    scope,
  };
  if (fresh) lockLinks([defined, prototype]);
  accepted.set(defined, record);
  return value;
};

const isHolder = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (types.isModuleNamespaceObject(value) || Object.isFrozen(value));

const reference = <T>(value: T, containers: readonly unknown[], roots?: readonly unknown[]): T => {
  const held = [...containers.slice(1), value];
  for (const [index, container] of containers.entries()) {
    if (!isHolder(container)) refuse("extends の右辺までの入れ物が凍結されていない");
    if (!Object.values(container as object).includes(held.at(index)))
      refuse("extends の右辺が、凍結された入れ物の値でない");
  }
  return accept(value, false, scopeOf(roots));
};

const product = <T>(value: T, probe: () => unknown, roots?: readonly unknown[]): T => {
  const [defined, prototype] = constructorOf(value);
  const [expected, expectedPrototype] = constructorOf(probe());
  const sameParents =
    defined !== expected &&
    parentOf(defined) === parentOf(expected) &&
    parentOf(prototype) === parentOf(expectedPrototype);
  if (!sameParents)
    refuse("factory の返り値の鎖が、信頼する factory を素の引数で呼んだときの鎖と違う");
  return accept(value, true, scopeOf(roots));
};

const unknown = (value: unknown): never => {
  void value;
  return refuse(
    "extends の右辺が、外の package の import にも信頼する factory の呼び出しにも根を持たない",
  );
};

const sameLinks = (links: readonly object[], expected: readonly object[]): boolean =>
  links.length === expected.length && links.every((link, index) => link === expected.at(index));

const assertParents = (defined: Defined, based: boolean): void => {
  const parent = parentOf(defined);
  const prototypeParent = parentOf(defined.prototype as object);
  if (!based) {
    if (parent !== FUNCTION_PROTOTYPE || prototypeParent !== Object.prototype)
      refuse("extends の無い class の親が差し替えられた");
    if (!matchesRecord(FUNCTION_PROTOTYPE))
      refuse("Function.prototype の親が、起動のときの記録と違う");
    return;
  }
  const recorded = parent === null ? undefined : accepted.get(parent);
  const kept =
    parent !== null &&
    recorded !== undefined &&
    prototypeParent === recorded.prototypes.at(0) &&
    sameLinks(chainOf(parent, recorded.fresh, recorded.scope), recorded.constructors) &&
    sameLinks(chainOf(prototypeParent, recorded.fresh, recorded.scope), recorded.prototypes);
  if (!kept) refuse("確かめた継承元の鎖が、class の定義の途中で差し替えられた");
};

const enter = (defined: Defined, based: boolean): void => {
  assertParents(defined, based);
  localClasses.add(defined);
  localClasses.add(defined.prototype as object);
};

const seal = (defined: Defined, module: string, based: boolean): void => {
  assertParents(defined, based);
  Object.preventExtensions(defined);
  Object.preventExtensions(defined.prototype as object);
  sealedByModule.set(module, (sealedByModule.get(module) ?? 0) + 1);
};

const sealedModules = (): ReadonlyMap<string, number> => sealedByModule;

const classSeal = { enter, product, reference, seal, sealedModules, share, unknown };

export default classSeal;
