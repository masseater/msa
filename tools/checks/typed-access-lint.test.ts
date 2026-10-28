import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";
import typedAccess from "./typed-access.ts";

const { lintAndInspectProbes, probePath, repoRoot } = lintProbe;

const DIR = "apps/coding-agent/src";

const KEY_HEADER = [
  "declare const key: string;",
  "declare const record: Record<string, number>;",
  "let target = 0;",
];

const keyCases: Readonly<Record<string, readonly [string, boolean]>> = {
  anyKey: ["declare const k: any;\nrecord[k];", true],
  assignmentPattern: ["({ [key]: target } = record);", true],
  bindingPattern: ["const { [key]: value } = record;", true],
  brandedKey: ["declare const id: string & { readonly brand: unique symbol };\nrecord[id];", true],
  constLiteral: ['const KEY = "a";\nrecord[KEY];', false],
  forOfPattern: ["for (const { [key]: item } of [record]) target = item ?? 0;", true],
  keyofClass: ["class Local {}\ndeclare const k: keyof typeof Local;\nLocal[k];", true],
  literalKey: ['record["a"];', false],
  nestedAssignmentPattern: ["[{ [key]: target }] = [record];", true],
  numberIndex: ["declare const index: number;\n[1, 2][index];", false],
  objectLiteralCreation: ["const made = { [key]: 1 };", false],
  safeLiteralUnion: ['declare const k: "a" | "b";\nrecord[k];', false],
  stringKeyRead: ["record[key];", true],
  stringKeyWrite: ["record[key] = 1;", true],
  symbolKey: ['const tag = Symbol("tag");\nconst tagged = { [tag]: 1 };\ntagged[tag];', false],
  templateKey: ["declare const name: `x-${string}`;\nrecord[name];", true],
  typeParameter: ["const get = <K extends string>(o: Record<K, number>, k: K) => o[k];", true],
  unsafeLiteralUnion: ['declare const k: "a" | "prototype";\nrecord[k];', true],
};

const holderCases: Readonly<Record<string, readonly [readonly string[], boolean]>> = {
  deepFrozen: [
    [
      "const inner = Object.freeze({ Base: class {} });",
      "const outer = Object.freeze({ inner });",
      "export class X extends outer.inner.Base {}",
    ],
    false,
  ],
  deepUnfrozen: [
    [
      "const inner = { Base: class {} };",
      "const outer = Object.freeze({ inner });",
      "export class X extends outer.inner.Base {}",
    ],
    true,
  ],
  factoryOnUnfrozen: [
    ["const lib = { make: () => class {} };", "export class X extends lib.make() {}"],
    true,
  ],
  frozenDefaultExport: [
    ['import tui from "@msa/tui";', "export class X extends tui.Container {}"],
    false,
  ],
  letHolder: [
    ["let holder = Object.freeze({ Base: class {} });", "export class X extends holder.Base {}"],
    true,
  ],
  namedNamespace: [
    ['import { Data } from "effect";', 'export class X extends Data.TaggedError("X") {}'],
    false,
  ],
  namespaceImport: [
    ['import * as DataNs from "effect/Data";', 'export class X extends DataNs.TaggedError("X") {}'],
    false,
  ],
  notStaticPath: [["export class X extends [class {}][0]! {}"], true],
  unfrozenImported: [
    [
      'import holder from "./lint-holder-source-probe.ts";',
      "export class X extends holder.Base {}",
    ],
    true,
  ],
};

const keyProbes = Object.entries(keyCases).map(([name, [body, expected]]) => ({
  expected,
  name,
  path: probePath(DIR, `typed-key-${name}`),
  source: [...KEY_HEADER, body, "export {};", ""].join("\n"),
}));

const holderProbes = Object.entries(holderCases).map(([name, [lines, expected]]) => ({
  expected,
  name,
  path: probePath(DIR, `typed-holder-${name}`),
  source: [...lines, ""].join("\n"),
}));

const holderSource = {
  [probePath(DIR, "holder-source")]: "const holder = { Base: class {} };\nexport default holder;\n",
};

it("reports computed keys that admit arbitrary strings, and extends whose holders are neither module namespaces nor frozen", () =>
  lintAndInspectProbes(
    {
      ...holderSource,
      ...Object.fromEntries(
        [...keyProbes, ...holderProbes].map(({ path, source }) => [path, source]),
      ),
    },
    (run) => typedAccess.scan({ files: (name) => name.startsWith(`${run}/`), root: run }),
  ).then(({ inspected }) => {
    const found = (path: string, rule: string) =>
      inspected.some((finding) => finding.file === path && finding.rule === rule);
    const outcomes = (probes: typeof keyProbes, rule: string) =>
      Object.fromEntries(probes.map(({ name, path }) => [name, found(path, rule)]));
    const expected = (probes: typeof keyProbes) =>
      Object.fromEntries(probes.map(({ expected: value, name }) => [name, value]));
    expect({
      holders: outcomes(holderProbes, "extends-holder"),
      keys: outcomes(keyProbes, "computed-key"),
    }).toEqual({ holders: expected(holderProbes), keys: expected(keyProbes) });
    return undefined;
  }));

it("leaves no computed key or unfrozen extends holder in coding-agent src", () => {
  const findings = typedAccess.scan({
    files: (name) => name.includes(`/${DIR}/`),
    root: repoRoot,
  });
  expect(findings.map(({ file, line, rule, text }) => `${file}:${line} ${rule} ${text}`)).toEqual(
    [],
  );
});
