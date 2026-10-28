import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";
import typedAccess from "./typed-access.ts";

const { lintAndInspectProbes, probePath } = lintProbe;

const dir = "apps/coding-agent/src";

const RULES: ReadonlySet<string> = new Set([
  "msa(no-builtin-require)",
  "msa(no-local-class-extends)",
  "msa(no-prototype-write)",
]);

const HEADER = [
  'import tui from "@msa/tui";',
  'import { Schema } from "effect";',
  "class LocalBase {}",
  "declare const key: string;",
  "declare const code: string;",
  "export class Probe extends tui.Container {}",
];

const reached: Readonly<Record<string, readonly string[]>> = {
  assignPrototype: ["Object.assign(Probe, { prototype: LocalBase.prototype });"],
  assignSpreadSource: ["const source = { ...LocalBase };", "Object.assign(Probe, source);"],
  computedConstructorConcat: ['(Probe as never)["const" + "ructor"];'],
  computedConstructorOnAny: [
    "(Object.getPrototypeOf(async () => undefined) as Record<string, unknown>)[key];",
  ],
  computedConstructorOnFunction: ["(Probe as unknown as Record<string, unknown>)[key];"],
  constructorOfFunction: ["(async () => undefined).constructor;"],
  constructorOfPrototype: ["Object.getPrototypeOf(async () => undefined).constructor;"],
  dataImport: ['await import("data:text/javascript,export default 1");'],
  defineProperties: [
    "Object.defineProperties(Probe, { prototype: { value: LocalBase.prototype } });",
  ],
  definePropertyComputed: ["Object.defineProperty(Probe, key, { value: LocalBase });"],
  definePropertyPrototype: [
    'Object.defineProperty(Probe, "prototype", { value: LocalBase.prototype });',
  ],
  descriptorSetter: [
    "Object.getOwnPropertyDescriptor(Object.prototype, key)?.set?.call(Probe, LocalBase);",
  ],
  descriptors: ["Object.getOwnPropertyDescriptors(Object.prototype);"],
  destructuredSetPrototypeOf: [
    "const { setPrototypeOf: reparent } = Object;",
    "reparent(Probe, LocalBase);",
  ],
  evalCall: ['eval("1");'],
  functionCall: ['Function("return 1");'],
  globalThisComputed: ["(globalThis as unknown as Record<string, unknown>)[key];"],
  globalThisEval: ['globalThis.eval("1");'],
  globalThisObject: ["globalThis.Object.setPrototypeOf(Probe, LocalBase);"],
  lookupSetter: ['Object.prototype.__lookupSetter__("x");'],
  newFunction: ["new Function(code);"],
  objectAlias: ["const O = Object;", "O.create(LocalBase.prototype);"],
  objectBindCall: ["Function.prototype.call.bind(Object.setPrototypeOf);"],
  objectComputed: ["(Object as unknown as Record<string, unknown>)[key];"],
  objectCreate: ["Object.create(LocalBase.prototype);"],
  protoAssign: ["(Probe as unknown as { __proto__: unknown }).__proto__ = LocalBase;"],
  protoComputedLiteral: ['(Probe as unknown as Record<string, unknown>)["__proto__"] = LocalBase;'],
  prototypeAssign: ["(Probe as { prototype: unknown }).prototype = LocalBase.prototype;"],
  reflectComputed: ["(Reflect as unknown as Record<string, unknown>)[key];"],
  reflectDefineProperty: [
    'Reflect.defineProperty(Probe, "prototype", { value: LocalBase.prototype });',
  ],
  reflectSetComputed: ["Reflect.set(Probe, key, LocalBase);"],
  reflectSetPrototype: ['Reflect.set(Probe, "prototype", LocalBase.prototype);'],
  reflectSetPrototypeOf: ["Reflect.setPrototypeOf(Probe, LocalBase);"],
  setPrototypeOf: ["Object.setPrototypeOf(Probe, LocalBase);"],
  timerString: ['setTimeout("1", 0);'],
  workerEval: [
    "declare const Worker: new (url: string, options: object) => unknown;",
    'new Worker("1", { eval: true });',
  ],
};

const laundered: Readonly<Record<string, readonly string[]>> = {
  anyIntoTypedVariable: [
    "const proto: Record<string, unknown> = Object.getPrototypeOf(Probe.prototype);",
    "proto[key] = LocalBase.prototype;",
  ],
  castIntoTypedVariable: [
    "const holder: Record<string, Record<string, (source: string) => unknown>> = {} as never;",
    "holder[key]![key]!(code);",
  ],
  functionPrototypeThroughVariable: [
    "function Sub() {}",
    "const sub: Record<string, unknown> = Sub as never;",
    "sub[key] = new LocalBase();",
  ],
};

const probes = Object.entries({ ...reached, ...laundered }).map(([name, lines]) => ({
  name,
  path: probePath(dir, `reach-${name}`),
  source: [...HEADER, ...lines, ""].join("\n"),
}));

it("reports every form that reaches a prototype, a constructor or generated code in coding-agent src, including values whose type was laundered", () =>
  lintAndInspectProbes(
    Object.fromEntries(probes.map(({ path, source }) => [path, source])),
    (run) => typedAccess.scan({ files: (name) => name.startsWith(`${run}/`), root: run }),
  ).then(({ diagnostics, inspected }) => {
    const reportedFor = (path: string): boolean =>
      diagnostics.some(
        (diagnostic) => diagnostic.filename === path && RULES.has(diagnostic.code),
      ) || inspected.some((finding) => finding.file === path);
    expect(Object.fromEntries(probes.map(({ name, path }) => [name, reportedFor(path)]))).toEqual(
      Object.fromEntries(probes.map(({ name }) => [name, true])),
    );
    return undefined;
  }));
