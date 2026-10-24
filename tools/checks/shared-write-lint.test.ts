import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { codesOnLine, lintProbes, probePath } = lintProbe;

const LOCAL_EXTENDS = "msa(no-local-class-extends)";

type Cases = readonly (readonly [string, string | undefined])[];

const WRITER_HEADER = [
  'import tui from "@msa/tui";',
  'import { Container } from "@msa/tui";',
  'import fsNs from "node:fs";',
  'import nodeEvents from "node:events";',
  'import bareEvents from "events";',
  "class Base {}",
  "declare const key: string;",
  "declare function declared<T>(value: T): T;",
  "const pkgAlias = tui;",
  "let laterAlias: typeof tui | undefined;",
  "laterAlias = tui;",
  "const { Box } = tui;",
  "const local = { Container: Base };",
];

const writerCases: Cases = [
  ["tui.Container = Base as never;", LOCAL_EXTENDS],
  ['tui["Container"] = Base as never;', LOCAL_EXTENDS],
  ["(tui as unknown as Record<string, unknown>)[key] = Base;", LOCAL_EXTENDS],
  ["tui.Container ??= Base as never;", LOCAL_EXTENDS],
  ["(tui as unknown as { count: number }).count++;", LOCAL_EXTENDS],
  ["delete (tui as { Container?: unknown }).Container;", LOCAL_EXTENDS],
  ["[tui.Container] = [Base as never];", LOCAL_EXTENDS],
  ["({ Container: tui.Container } = { Container: Base as never });", LOCAL_EXTENDS],
  ["for (tui.Container of [Base as never]) declared(tui);", LOCAL_EXTENDS],
  ["for (tui.Container in {}) declared(tui);", LOCAL_EXTENDS],
  ["Container.prototype.render = () => [];", LOCAL_EXTENDS],
  ["pkgAlias.Box = Base as never;", LOCAL_EXTENDS],
  ["laterAlias!.Box = Base as never;", LOCAL_EXTENDS],
  ["Box.prototype.render = () => [];", LOCAL_EXTENDS],
  ["globalThis.Error = Base as never;", undefined],
  ["fsNs.readFileSync = fsNs.readFileSync;", undefined],
  ["local.Container = Base;", undefined],
  ["nodeEvents.EventEmitter = Base as never;", undefined],
  ["bareEvents.EventEmitter = Base as never;", undefined],
];

const readerCases: Cases = [
  ["export class R1 extends tui.Container {}", undefined],
  ["export class R2 extends tui.Box {}", undefined],
  ["export class R3 extends EventEmitter {}", LOCAL_EXTENDS],
  ["export class R4 extends events.EventEmitter {}", LOCAL_EXTENDS],
];

const READER_HEADER = [
  'import tui from "@msa/tui";',
  'import events, { EventEmitter } from "events";',
];

const probes = [
  { cases: writerCases, header: WRITER_HEADER, kind: "shared-write-writer" },
  { cases: readerCases, header: READER_HEADER, kind: "shared-write-reader" },
].map((probe) => Object.assign(probe, { path: probePath("apps/coding-agent/src", probe.kind) }));

it("reports writes to package imports and their aliases where they are written, not where they are extended", () =>
  lintProbes(
    Object.fromEntries(
      probes.map(({ cases, header, path }) => [
        path,
        [...header, ...cases.map(([statement]) => statement)].join("\n"),
      ]),
    ),
  ).then((report) => {
    expect(
      probes.flatMap(({ cases, header, path }) =>
        cases.map(([statement], index) => ({
          codes: codesOnLine(report, path, header.length + index + 1, LOCAL_EXTENDS),
          statement,
        })),
      ),
    ).toEqual(
      probes.flatMap(({ cases }) =>
        cases.map(([statement, expected]) => ({
          codes: expected === undefined ? [] : [expected],
          statement,
        })),
      ),
    );
    return undefined;
  }));
