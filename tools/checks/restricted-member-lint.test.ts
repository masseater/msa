import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { lintProbes, msaCodesOnLine, probePath } = lintProbe;

const RESTRICTED = "msa(no-restricted-member)";

const HEADER = [
  'import { NodeHttpServer } from "@effect/platform-node";',
  'import { NodeHttpServer as Aliased } from "@effect/platform-node";',
  'import * as PlatformNode from "@effect/platform-node";',
  'import * as HttpServerModule from "@effect/platform-node/NodeHttpServer";',
];

const cases: readonly (readonly [statement: string, expected: string | undefined])[] = [
  ["export const a = NodeHttpServer.layerTest;", RESTRICTED],
  ['export const b = NodeHttpServer["layerTest"];', RESTRICTED],
  ["export const c = Aliased.layerTest;", RESTRICTED],
  ["export const d = PlatformNode.NodeHttpServer.layerTest;", RESTRICTED],
  ["export const e = HttpServerModule.layerTest;", RESTRICTED],
  ["export const { layerTest: f } = NodeHttpServer;", RESTRICTED],
  ["const alias = NodeHttpServer; export const g = alias.layerTest;", RESTRICTED],
  ['import { layerTest } from "@effect/platform-node/NodeHttpServer";', RESTRICTED],
  ["export const h = NodeHttpServer.layer;", undefined],
  ["export const i = HttpServerModule.layer;", undefined],
];

const PROBE = probePath("libs/testing/test", "restricted-member");

const probe = [...HEADER, ...cases.map(([statement]) => statement)].join("\n");

it("flags NodeHttpServer.layerTest through every import path", () =>
  lintProbes({ [PROBE]: probe }).then((report) => {
    for (const [index, [statement, expected]] of cases.entries()) {
      const codes = msaCodesOnLine(report, PROBE, HEADER.length + index + 1);
      expect({ codes, statement }).toEqual({
        codes: expected === undefined ? [] : [expected],
        statement,
      });
    }
    return undefined;
  }));
