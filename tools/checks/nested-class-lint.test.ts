import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { lintProbes, probePath } = lintProbe;

const NESTED = "msa(no-nested-class)";

const HEADER = 'import tui from "@msa/tui";\ndeclare const flag: boolean;';

const moduleLevel: Readonly<Record<string, string>> = {
  declaration: "class A {}\nexport default A;",
  defaultExport: "export default class extends tui.Container {}",
  namedExport: "export class B extends tui.Container {}",
  satisfiesInitializer: "export const C = class {} satisfies object;",
  variableInitializer: "export const D = class {};",
};

const nested: Readonly<Record<string, string>> = {
  arrowBody: "export const make = () => class {};",
  block: "if (flag) { class E {} void E; }",
  conditional: "export const F = flag ? class {} : class {};",
  functionBody: "export function make() { return class {}; }",
  objectValue: "export const holder = { G: class {} };",
  staticBlock: "export class I { static { class Inner {} void Inner; } }",
  staticField: "export class H { static Inner = class {}; }",
};

const probesOf = (forms: Readonly<Record<string, string>>, kind: string) =>
  Object.entries(forms).map(([name, body]) => ({
    name,
    path: probePath("apps/coding-agent/src", `nested-class-${kind}-${name}`),
    source: `${HEADER}\n${body}\n`,
  }));

const moduleLevelProbes = probesOf(moduleLevel, "top");
const nestedProbes = probesOf(nested, "nested");

it("reports coding-agent classes that are not defined when their module loads", () =>
  lintProbes(
    Object.fromEntries(
      [...moduleLevelProbes, ...nestedProbes].map(({ path, source }) => [path, source]),
    ),
  ).then((report) => {
    const reported = (probes: readonly { readonly name: string; readonly path: string }[]) =>
      Object.fromEntries(
        probes.map(({ name, path }) => [
          name,
          report.some((diagnostic) => diagnostic.filename === path && diagnostic.code === NESTED),
        ]),
      );
    expect({ moduleLevel: reported(moduleLevelProbes), nested: reported(nestedProbes) }).toEqual({
      moduleLevel: Object.fromEntries(moduleLevelProbes.map(({ name }) => [name, false])),
      nested: Object.fromEntries(nestedProbes.map(({ name }) => [name, true])),
    });
    return undefined;
  }));
