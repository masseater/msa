import { expect, it } from "vite-plus/test";

import classExtendsCases from "./class-extends-cases.ts";
import lintProbe from "./lint-probe.ts";

const { codesOnLine, lintProbes, probePath } = lintProbe;

const { HEADER, LOCAL_EXTENDS, cases } = classExtendsCases;

type Cases = typeof cases;

const probes = cases.map(([statement, expected, setup = []], index) => ({
  cases: [[statement, expected]] as Cases,
  header: [...HEADER, ...setup],
  path: probePath("apps/coding-agent/src", `class-extends-${index}`),
}));

const sourceOf = (header: readonly string[], probeCases: Cases): string =>
  [...header, ...probeCases.map(([statement]) => statement)].join("\n");

it("flags coding-agent classes whose superclass is not syntactically a class from outside the package", () =>
  lintProbes(
    Object.fromEntries(
      probes.map(({ cases: probeCases, header, path }) => [path, sourceOf(header, probeCases)]),
    ),
  ).then((report) => {
    expect(
      probes.flatMap(({ cases: probeCases, header, path }) =>
        probeCases.map(([statement], index) => ({
          codes: codesOnLine(report, path, header.length + index + 1, LOCAL_EXTENDS),
          statement,
        })),
      ),
    ).toEqual(
      probes.flatMap(({ cases: probeCases }) =>
        probeCases.map(([statement, expected]) => ({
          codes: expected === undefined ? [] : [expected],
          statement,
        })),
      ),
    );
    return undefined;
  }));
