import { expect, it } from "vite-plus/test";

import classSealProcess from "./class-seal-process.ts";
import Local from "./fixtures/class-seal/local.ts";

const { runNode } = classSealProcess;

const sourceResolver = `${import.meta.dirname}/../src/experimental/source-resolver.ts`;

type Outcome =
  | "local-base"
  | "not-extensible"
  | "read-only"
  | "loads"
  | "write-refused"
  | `other: ${string}`;

type Fixture = { readonly default: unknown };

type Subject = { readonly local: unknown; readonly subject: unknown; readonly written?: boolean };

const fixtures: Readonly<Record<string, () => Promise<Fixture>>> = {
  cast: () => import("./fixtures/class-seal/cast.ts"),
  "context-service": () => import("./fixtures/class-seal/context-service.ts"),
  "data-tagged-error": () => import("./fixtures/class-seal/data-tagged-error.ts"),
  direct: () => import("./fixtures/class-seal/direct.ts"),
  "dynamic-proto-key": () => import("./fixtures/class-seal/dynamic-proto-key.ts"),
  "external-subclass": () => import("./fixtures/class-seal/external-subclass.ts"),
  "factory-arrow-local": () => import("./fixtures/class-seal/factory-arrow-local.ts"),
  "factory-cast-local": () => import("./fixtures/class-seal/factory-cast-local.ts"),
  "factory-live-binding": () => import("./fixtures/class-seal/factory-live-binding.ts"),
  "factory-object-local": () => import("./fixtures/class-seal/factory-object-local.ts"),
  "factory-registry-local": () => import("./fixtures/class-seal/factory-registry-local.ts"),
  "factory-spread-local": () => import("./fixtures/class-seal/factory-spread-local.ts"),
  "factory-tag-local": () => import("./fixtures/class-seal/factory-tag-local.ts"),
  "function-prototype": () => import("./fixtures/class-seal/function-prototype.ts"),
  iife: () => import("./fixtures/class-seal/iife.ts"),
  "issue224-box": () => import("./fixtures/class-seal/issue224-box.ts"),
  "issue224-effect-namespace": () => import("./fixtures/class-seal/issue224-effect-namespace.ts"),
  "issue224-for-each": () => import("./fixtures/class-seal/issue224-for-each.ts"),
  "issue224-list": () => import("./fixtures/class-seal/issue224-list.ts"),
  "issue224-map": () => import("./fixtures/class-seal/issue224-map.ts"),
  "issue224-object-assign": () => import("./fixtures/class-seal/issue224-object-assign.ts"),
  "issue224-passthrough": () => import("./fixtures/class-seal/issue224-passthrough.ts"),
  "issue224-put": () => import("./fixtures/class-seal/issue224-put.ts"),
  "issue224-reflect-set": () => import("./fixtures/class-seal/issue224-reflect-set.ts"),
  "live-binding": () => import("./fixtures/class-seal/live-binding.ts"),
  "map-registry": () => import("./fixtures/class-seal/map-registry.ts"),
  mixin: () => import("./fixtures/class-seal/mixin.ts"),
  "prototype-after": () => import("./fixtures/class-seal/prototype-after.ts"),
  proxy: () => import("./fixtures/class-seal/proxy.ts"),
  "proxy-prototype": () => import("./fixtures/class-seal/proxy-prototype.ts"),
  "receiver-register": () => import("./fixtures/class-seal/receiver-register.ts"),
  "registry-across-modules": () => import("./fixtures/class-seal/registry-across-modules.ts"),
  "schema-fields-local": () => import("./fixtures/class-seal/schema-fields-local.ts"),
  "schema-ordinary": () => import("./fixtures/class-seal/schema-ordinary.ts"),
  "schema-tagged-error": () => import("./fixtures/class-seal/schema-tagged-error.ts"),
  "set-prototype-of-after": () => import("./fixtures/class-seal/set-prototype-of-after.ts"),
  "set-prototype-of-function": () => import("./fixtures/class-seal/set-prototype-of-function.ts"),
  "shared-after-error-base": () => import("./fixtures/class-seal/shared-after-error-base.ts"),
  "shared-after-factory-product": () =>
    import("./fixtures/class-seal/shared-after-factory-product.ts"),
  "shared-after-tui-prototype": () => import("./fixtures/class-seal/shared-after-tui-prototype.ts"),
  "shared-context-service": () => import("./fixtures/class-seal/shared-context-service.ts"),
  "shared-error-base": () => import("./fixtures/class-seal/shared-error-base.ts"),
  "shared-error-base-prototype": () =>
    import("./fixtures/class-seal/shared-error-base-prototype.ts"),
  "shared-error-global": () => import("./fixtures/class-seal/shared-error-global.ts"),
  "shared-function-prototype": () => import("./fixtures/class-seal/shared-function-prototype.ts"),
  "shared-tui-container": () => import("./fixtures/class-seal/shared-tui-container.ts"),
  "shared-tui-text-prototype": () => import("./fixtures/class-seal/shared-tui-text-prototype.ts"),
  "shared-yieldable-error": () => import("./fixtures/class-seal/shared-yieldable-error.ts"),
  "static-local-before-seal": () => import("./fixtures/class-seal/static-local-before-seal.ts"),
  "static-reparent": () => import("./fixtures/class-seal/static-reparent.ts"),
  "trusted-call-local-beside": () => import("./fixtures/class-seal/trusted-call-local-beside.ts"),
  "tui-container": () => import("./fixtures/class-seal/tui-container.ts"),
};

const reachCases: Readonly<Record<string, Outcome>> = {
  cast: "local-base",
  direct: "local-base",
  "dynamic-proto-key": "not-extensible",
  "external-subclass": "local-base",
  "function-prototype": "local-base",
  iife: "local-base",
  "live-binding": "local-base",
  "map-registry": "local-base",
  mixin: "local-base",
  "prototype-after": "not-extensible",
  proxy: "local-base",
  "proxy-prototype": "local-base",
  "receiver-register": "local-base",
  "registry-across-modules": "local-base",
  "set-prototype-of-after": "not-extensible",
  "set-prototype-of-function": "local-base",
  "shared-after-error-base": "write-refused",
  "shared-after-factory-product": "not-extensible",
  "shared-after-tui-prototype": "write-refused",
  "shared-context-service": "write-refused",
  "shared-error-base": "write-refused",
  "shared-error-base-prototype": "write-refused",
  "shared-error-global": "write-refused",
  "shared-function-prototype": "write-refused",
  "shared-tui-container": "not-extensible",
  "shared-tui-text-prototype": "write-refused",
  "shared-yieldable-error": "not-extensible",
  "static-local-before-seal": "local-base",
  "static-reparent": "local-base",
};

const frozenCases: Readonly<Record<string, Outcome>> = {
  "issue224-box": "read-only",
  "issue224-effect-namespace": "read-only",
  "issue224-for-each": "read-only",
  "issue224-list": "read-only",
  "issue224-map": "read-only",
  "issue224-object-assign": "read-only",
  "issue224-passthrough": "read-only",
  "issue224-put": "read-only",
  "issue224-reflect-set": "read-only",
};

const factoryArgumentCases: Readonly<Record<string, Outcome>> = {
  "factory-arrow-local": "loads",
  "factory-cast-local": "loads",
  "factory-live-binding": "loads",
  "factory-object-local": "loads",
  "factory-registry-local": "loads",
  "factory-spread-local": "loads",
  "factory-tag-local": "loads",
  "schema-fields-local": "loads",
  "trusted-call-local-beside": "loads",
};

const ordinaryCases: Readonly<Record<string, Outcome>> = {
  "context-service": "loads",
  "data-tagged-error": "loads",
  "schema-ordinary": "loads",
  "schema-tagged-error": "loads",
  "tui-container": "loads",
};

const subjectOf = (value: unknown): Subject =>
  typeof value === "object" && value !== null && "subject" in value && "local" in value
    ? (value as Subject)
    : { local: Local, subject: value };

const reaches = ({ local, subject }: Subject): boolean => {
  const marks = [local, (local as { readonly prototype: unknown }).prototype];
  const links = [
    ...chainOf(subject),
    ...chainOf((subject as { readonly prototype?: unknown }).prototype),
  ];
  return links.some((link) => marks.includes(link));
};

const chainOf = (value: unknown): readonly unknown[] => {
  const chain: unknown[] = [];
  for (let current = value; current !== null && current !== undefined;) {
    chain.push(current);
    current = Object.getPrototypeOf(current) as unknown;
  }
  return chain;
};

const outcomeOf = (error: unknown): Outcome => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("同じパッケージで定義したクラスを継承しない")) return "local-base";
  if (/not extensible/u.test(message)) return "not-extensible";
  if (/read[- ]only|Cannot assign|Cannot add property/u.test(message)) return "read-only";
  return `other: ${message}`;
};

const load = (name: string): Promise<Outcome> => {
  const loader = fixtures[name];
  if (loader === undefined) return Promise.reject(new Error(`no fixture ${name}`));
  return loader().then(
    (fixture) => {
      const subject = subjectOf(fixture.default);
      if (reaches(subject)) throw new Error(`${name}: a class of the package reached the chain`);
      return subject.written === false ? ("write-refused" as const) : ("loads" as const);
    },
    (error: unknown) => outcomeOf(error),
  );
};

const outcomesOf = (cases: Readonly<Record<string, Outcome>>) =>
  Promise.all(Object.keys(cases).map((name) => load(name).then((got) => [name, got]))).then(
    (entries) => Object.fromEntries(entries),
  );

const unsealedScript = (name: string): string =>
  [
    `const [{ default: fixture }, { default: local }] = await Promise.all([`,
    `  import(${JSON.stringify(`${import.meta.dirname}/fixtures/class-seal/${name}.ts`)}),`,
    `  import(${JSON.stringify(`${import.meta.dirname}/fixtures/class-seal/local.ts`)}),`,
    "]);",
    "const chain = (value) => { const links = []; for (let v = value; v !== null && v !== undefined; v = Object.getPrototypeOf(v)) links.push(v); return links; };",
    'const { local: base, subject } = typeof fixture === "object" && fixture !== null && "subject" in fixture ? fixture : { local, subject: fixture };',
    "const links = [...chain(subject), ...chain(subject.prototype)];",
    'process.stdout.write(links.some((link) => link === base || link === base.prototype) ? "reached" : "loads");',
  ].join("\n");

const plainOutcome = ({ stderr, stdout }: { readonly stderr: string; readonly stdout: string }) =>
  stdout === "" ? outcomeOf(new Error(stderr)) : stdout;

const unsealed = (cases: Readonly<Record<string, Outcome>>) =>
  Promise.all(
    Object.keys(cases).map((name) =>
      runNode(
        ["--import", sourceResolver, "--input-type=module", "--eval", unsealedScript(name)],
        import.meta.dirname,
      ).then((result) => [name, plainOutcome(result)]),
    ),
  ).then((entries) => Object.fromEntries(entries));

const sameKeys = (cases: Readonly<Record<string, Outcome>>, value: string) =>
  Object.fromEntries(Object.keys(cases).map((name) => [name, value]));

it("stops every input that puts a class of the package into the chain of one, and each input reaches the chain without the seal", () =>
  Promise.all([outcomesOf(reachCases), unsealed(reachCases)]).then(([sealed, plain]) => {
    expect(sealed).toEqual(reachCases);
    expect(plain).toEqual(sameKeys(reachCases, "reached"));
    return undefined;
  }));

it("keeps the frozen package exports read-only, with or without the seal", () =>
  Promise.all([outcomesOf(frozenCases), unsealed(frozenCases)]).then(([sealed, plain]) => {
    expect(sealed).toEqual(frozenCases);
    expect(plain).toEqual(frozenCases);
    return undefined;
  }));

it("keeps a class of the package out of the chain when it is only a factory argument", () =>
  outcomesOf(factoryArgumentCases).then((got) => {
    expect(got).toEqual(factoryArgumentCases);
    return undefined;
  }));

it("loads classes built with ordinary Effect and tui code", () =>
  outcomesOf(ordinaryCases).then((got) => {
    expect(got).toEqual(ordinaryCases);
    return undefined;
  }));
