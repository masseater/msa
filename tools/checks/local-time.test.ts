import { expect, it } from "vite-plus/test";

import localTimeRules from "../../local-time-rules.config.ts";
import lintProbe from "./lint-probe.ts";
import localTimeCheck from "./local-time.ts";

const { codesOnLine, lintAndInspectProbes, probePath, repoRoot } = lintProbe;

const PROPERTIES = "eslint(no-restricted-properties)";

const MEMBER = "msa(no-restricted-member)";

const CHECK = "check";

const HEADER = [
  'import { DateTime } from "effect";',
  "declare const date: Date;",
  "declare const ms: number;",
];

const cases: Readonly<Record<string, readonly [statement: string, caughtBy: string | undefined]>> =
  {
    aliasedImport: [
      'import { zoneMakeLocal as aliased } from "effect/DateTime";\nexport const v = aliased();',
      MEMBER,
    ],
    concat: ['export const v = "at " + date;', CHECK],
    dateCall: ["export const v = Date();", CHECK],
    destructured: ["export const { getMinutes: v } = Date.prototype;", PROPERTIES],
    effectFormatLocal: ["export const v = DateTime.formatLocal(DateTime.makeUnsafe(ms));", MEMBER],
    effectLayer: ["export const v = DateTime.layerCurrentZoneLocal;", MEMBER],
    effectZoneLocal: ["export const v = DateTime.zoneMakeLocal();", MEMBER],
    elementAccess: ['export const v = date["getDate"]();', PROPERTIES],
    getter: ["export const v = date.getHours();", PROPERTIES],
    intl: ['export const v = new Intl.DateTimeFormat("en").format(ms);', PROPERTIES],
    intlAlias: ["const I = Intl;\nexport const v = new I.DateTimeFormat();", CHECK],
    intlDestructured: ["export const { DateTimeFormat: v } = Intl;", PROPERTIES],
    isoString: ["export const v = date.toISOString();", undefined],
    localeString: ["export const v = date.toLocaleString();", CHECK],
    numberLocale: ["export const v = ms.toLocaleString();", undefined],
    reflect: [
      "export const v = Reflect.apply(Date.prototype.getDay, date, []);",
      `${PROPERTIES}+${CHECK}`,
    ],
    stringCall: ["export const v = String(date);", CHECK],
    template: ["export const v = `at ${date}`;", CHECK],
    time: ["export const v = date.getTime();", undefined],
    utcGetter: ["export const v = date.getUTCHours();", undefined],
    zonedNamed: ['export const v = DateTime.makeZonedUnsafe(ms, { timeZone: "UTC" });', undefined],
    zonedWithoutZone: ["export const v = DateTime.makeZonedUnsafe(ms);", CHECK],
  };

const DIR = "apps/coding-agent/src";

const probes = Object.entries(cases).map(([name, [statement, caughtBy]]) => ({
  caughtBy,
  lines: statement.split("\n").map((_line, index) => HEADER.length + index + 1),
  name,
  path: probePath(DIR, `local-time-${name}`),
  source: [...HEADER, statement, ""].join("\n"),
}));

const owners = {
  [localTimeRules.owners.dateGetters]: [...HEADER, "export const v = date.getHours();", ""],
  [localTimeRules.owners.localZone]: [...HEADER, "export const v = DateTime.zoneMakeLocal();", ""],
};

const ownerLine = HEADER.length + 1;

it("reports every way of reading the local time zone outside the one formatter", () =>
  lintAndInspectProbes(
    {
      ...Object.fromEntries(probes.map(({ path, source }) => [path, source])),
      ...Object.fromEntries(
        Object.entries(owners).map(([path, lines]) => [path, lines.join("\n")]),
      ),
    },
    (run) => localTimeCheck.scan({ files: (name) => name.startsWith(`${run}/`), root: run }),
  ).then(({ diagnostics, inspected }) => {
    const caughtBy = (path: string, lines: readonly number[]): string | undefined => {
      const lint = [PROPERTIES, MEMBER].find((code) =>
        lines.some((line) => codesOnLine(diagnostics, path, line, code).length > 0),
      );
      const checked = inspected.some((finding) => finding.file === path);
      return checked ? (lint === undefined ? CHECK : `${lint}+${CHECK}`) : lint;
    };
    expect({
      owners: Object.keys(owners).map((path) => caughtBy(path, [ownerLine])),
      probes: Object.fromEntries(
        probes.map(({ lines, name, path }) => [name, caughtBy(path, lines)]),
      ),
    }).toEqual({
      owners: [undefined, undefined],
      probes: Object.fromEntries(probes.map(({ caughtBy: expected, name }) => [name, expected])),
    });
    return undefined;
  }));

it("leaves no local time string built outside the one formatter", () => {
  const root = new URL(`file://${repoRoot}/`).pathname;
  const findings = localTimeCheck.scan({
    files: (name) =>
      name.startsWith(root) && !name.includes("/node_modules/") && !name.includes("/lint-probe/"),
    root: repoRoot,
  });
  expect(
    findings.map(({ detail, file, line, text }) => `${file}:${line} ${detail} ${text}`),
  ).toEqual([]);
});
