import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { codesOnLine, lintProbes, probePath } = lintProbe;

const IMPORT_ASSIGN = "eslint(no-import-assign)";
const GLOBAL_ASSIGN = "eslint(no-global-assign)";

const HEADER = [
  'import * as ns from "@msa/tui";',
  'import { Container } from "@msa/tui";',
  "class Base {}",
];

const cases: readonly (readonly [string, string])[] = [
  ["Container = Base as never;", IMPORT_ASSIGN],
  ["ns.Container = Base as never;", IMPORT_ASSIGN],
  ['ns["Container"] = Base as never;', IMPORT_ASSIGN],
  ["Object.assign(ns, { Container: Base });", IMPORT_ASSIGN],
  ["Error = Base as never;", GLOBAL_ASSIGN],
  ["RangeError ??= Base as never;", GLOBAL_ASSIGN],
];

const path = probePath("apps/coding-agent/src", "shared-binding-assign");

it("reports writes to imported bindings, namespaces and builtin globals", () =>
  lintProbes({
    [path]: [...HEADER, ...cases.map(([statement]) => statement)].join("\n"),
  }).then((report) => {
    expect(
      cases.map(([statement], index) => ({
        codes: codesOnLine(report, path, HEADER.length + index + 1, "eslint("),
        statement,
      })),
    ).toEqual(cases.map(([statement, code]) => ({ codes: [code], statement })));
    return undefined;
  }));
