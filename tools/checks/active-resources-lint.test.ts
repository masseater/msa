import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { codesOnLine, lintProbes, probePath } = lintProbe;

const RESTRICTED = "eslint(no-restricted-properties)";

const cases: readonly (readonly [statement: string, expected: string | undefined])[] = [
  ["export const a = process.getActiveResourcesInfo();", RESTRICTED],
  ["export const b = globalThis.process.getActiveResourcesInfo();", RESTRICTED],
  ["export const { getActiveResourcesInfo: c } = process;", RESTRICTED],
  ["export const d = process.memoryUsage();", undefined],
];

const PROBE = probePath("libs/testing/test", "active-resources");

const probe = cases.map(([statement]) => statement).join("\n");

it("flags process.getActiveResourcesInfo in tests", () =>
  lintProbes({ [PROBE]: probe }).then((report) => {
    for (const [index, [statement, expected]] of cases.entries()) {
      const codes = codesOnLine(report, PROBE, index + 1, RESTRICTED);
      expect({ codes, statement }).toEqual({
        codes: expected === undefined ? [] : [expected],
        statement,
      });
    }
    return undefined;
  }));
