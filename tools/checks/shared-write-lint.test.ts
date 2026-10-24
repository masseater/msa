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
  "const { assign } = Object;",
  'const SYMBOL_KEY = Symbol.for("k");',
  'let mutableKey = Symbol.for("k");',
  "const local = { Container: Base };",
];

const writerCases: Cases = [
  ["tui.Container = Base as never;", LOCAL_EXTENDS],
  ['tui["Container"] = Base as never;', LOCAL_EXTENDS],
  ["(tui as unknown as Record<string, unknown>)[key] = Base;", LOCAL_EXTENDS],
  ["tui.Container ??= Base as never;", LOCAL_EXTENDS],
  ["delete (tui as { Container?: unknown }).Container;", LOCAL_EXTENDS],
  ["[tui.Container] = [Base as never];", LOCAL_EXTENDS],
  ["({ Container: tui.Container } = { Container: Base as never });", LOCAL_EXTENDS],
  ["for (tui.Container of [Base as never]) declared(tui);", LOCAL_EXTENDS],
  ["Container.prototype.render = () => [];", LOCAL_EXTENDS],
  ["pkgAlias.Box = Base as never;", LOCAL_EXTENDS],
  ["globalThis.Error = Base as never;", LOCAL_EXTENDS],
  ['globalThis["Error"] = Base as never;', LOCAL_EXTENDS],
  ["(globalThis as unknown as Record<string, unknown>)[key] = Base;", LOCAL_EXTENDS],
  ["window.Error = Base as never;", LOCAL_EXTENDS],
  ["self.Error = Base as never;", LOCAL_EXTENDS],
  ["global.Error = Base as never;", LOCAL_EXTENDS],
  ["globalThis.globalThis.Error = Base as never;", LOCAL_EXTENDS],
  ['Function("return this")().Error = Base;', LOCAL_EXTENDS],
  ["globalThis.Intl.Collator = Base as never;", LOCAL_EXTENDS],
  ['Object.defineProperty(globalThis, "Error", { value: Base });', LOCAL_EXTENDS],
  ["Object.defineProperties(globalThis, { Error: { value: Base } });", LOCAL_EXTENDS],
  ['Reflect.set(globalThis, "Error", Base);', LOCAL_EXTENDS],
  ['Reflect.defineProperty(globalThis, "Error", { value: Base });', LOCAL_EXTENDS],
  ["Object.assign(globalThis, { Error: Base });", LOCAL_EXTENDS],
  ["globalThis.Object.assign(globalThis, { Error: Base });", LOCAL_EXTENDS],
  ["Object.assign(tui, { Container: Base });", LOCAL_EXTENDS],
  ['Reflect.set(tui, "Container", Base);', LOCAL_EXTENDS],
  ['Reflect.deleteProperty(tui, "Container");', LOCAL_EXTENDS],
  ['Object.defineProperty(tui.Container, "prototype", { value: Base.prototype });', LOCAL_EXTENDS],
  ['Object["defineProperty"](tui, "Container", { value: Base });', LOCAL_EXTENDS],
  ["assign(tui, { Container: Base });", LOCAL_EXTENDS],
  ["Object.assign(...([tui, { Container: Base }] as const));", LOCAL_EXTENDS],
  ["Object.assign.call(null, tui, { Container: Base });", LOCAL_EXTENDS],
  ["const globalAlias = globalThis;", LOCAL_EXTENDS],
  ["declared(globalThis);", LOCAL_EXTENDS],
  ['Symbol.for = () => "Error" as never;', LOCAL_EXTENDS],
  ["(globalThis as unknown as Record<symbol, unknown>)[mutableKey] = Base;", LOCAL_EXTENDS],
  ['(globalThis as unknown as Record<symbol, unknown>)[Symbol.for("k")] = Base;', undefined],
  ["(globalThis as unknown as Record<symbol, unknown>)[SYMBOL_KEY] = Base;", undefined],
  ["const fetcher: typeof globalThis.fetch = globalThis.fetch;", undefined],
  ['if (typeof globalThis.window === "undefined") declared(globalThis.fetch);', undefined],
  ["fsNs.readFileSync = fsNs.readFileSync;", undefined],
  ["local.Container = Base;", undefined],
  ["nodeEvents.EventEmitter = Base as never;", undefined],
  ["bareEvents.EventEmitter = Base as never;", undefined],
  ['(() => undefined).constructor("return this")().Error = Base;', LOCAL_EXTENDS],
  ['({}).constructor["constructor"]("return this")().Error = Base;', LOCAL_EXTENDS],
  ["const functionAlias = Function;", LOCAL_EXTENDS],
  ["const evalAlias = globalThis.eval;", LOCAL_EXTENDS],
  ["declared(Function);", LOCAL_EXTENDS],
  ['Reflect.construct(Function, ["return this"]);', LOCAL_EXTENDS],
  ["declare const functionType: typeof Function;", undefined],
];

const readerCases: Cases = [
  ["export class R1 extends tui.Container {}", undefined],
  ["export class R2 extends Error {}", undefined],
  ["export class R3 extends tui.Box {}", undefined],
  ["export class R4 extends EventEmitter {}", LOCAL_EXTENDS],
  ["export class R5 extends events.EventEmitter {}", LOCAL_EXTENDS],
];

const READER_HEADER = [
  'import tui from "@msa/tui";',
  'import events, { EventEmitter } from "events";',
];

const probes = [
  { cases: writerCases, header: WRITER_HEADER, kind: "shared-write-writer" },
  { cases: readerCases, header: READER_HEADER, kind: "shared-write-reader" },
].map((probe) => Object.assign(probe, { path: probePath("apps/coding-agent/src", probe.kind) }));

it("reports writes to the global object and package imports where they are written, not where they are extended", () =>
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
