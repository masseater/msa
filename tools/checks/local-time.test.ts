import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";
import localTimeCheck from "./local-time.ts";

const { lintAndInspectProbes, probePath, repoRoot } = lintProbe;

const HEADER = [
  'import { DateTime } from "effect";',
  "declare const date: Date;",
  "declare const ms: number;",
];

const cases: Readonly<Record<string, readonly [statement: string, flagged: boolean]>> = {
  aliasedImport: [
    'import { zoneMakeLocal as aliased } from "effect/DateTime";\nexport const v = aliased();',
    true,
  ],
  concat: ['export const v = "at " + date;', true],
  dateCall: ["export const v = Date();", true],
  destructured: ["export const { getMinutes: v } = Date.prototype;", true],
  effectFormatLocal: ["export const v = DateTime.formatLocal(DateTime.makeUnsafe(ms));", true],
  effectLayer: ["export const v = DateTime.layerCurrentZoneLocal;", true],
  effectZoneLocal: ["export const v = DateTime.zoneMakeLocal();", true],
  elementAccess: ['export const v = date["getDate"]();', true],
  getter: ["export const v = date.getHours();", true],
  intl: ['export const v = new Intl.DateTimeFormat("en").format(ms);', true],
  intlAlias: ["const I = Intl;\nexport const v = new I.DateTimeFormat();", true],
  isoString: ["export const v = date.toISOString();", false],
  localeString: ["export const v = date.toLocaleString();", true],
  numberLocale: ["export const v = ms.toLocaleString();", false],
  reflect: ["export const v = Reflect.apply(Date.prototype.getDay, date, []);", true],
  stringCall: ["export const v = String(date);", true],
  template: ["export const v = `at ${date}`;", true],
  time: ["export const v = date.getTime();", false],
  utcGetter: ["export const v = date.getUTCHours();", false],
  zonedNamed: ['export const v = DateTime.makeZonedUnsafe(ms, { timeZone: "UTC" });', false],
  zonedWithoutZone: ["export const v = DateTime.makeZonedUnsafe(ms);", true],
};

const DIR = "apps/coding-agent/src";

const probes = Object.entries(cases).map(([name, [statement, flagged]]) => ({
  flagged,
  name,
  path: probePath(DIR, `local-time-${name}`),
  source: [...HEADER, statement, ""].join("\n"),
}));

const [owner] = localTimeCheck.OWNERS;

it("reports every way of reading the local time zone outside the one formatter", () =>
  lintAndInspectProbes(
    {
      ...Object.fromEntries(probes.map(({ path, source }) => [path, source])),
      [owner!]: [...HEADER, "export const v = date.getHours();", ""].join("\n"),
    },
    (run) => localTimeCheck.scan({ files: (name) => name.startsWith(`${run}/`), root: run }),
  ).then(({ inspected }) => {
    const flagged = (path: string) => inspected.some((finding) => finding.file === path);
    expect({
      owner: flagged(owner!),
      probes: Object.fromEntries(probes.map(({ name, path }) => [name, flagged(path)])),
    }).toEqual({
      owner: false,
      probes: Object.fromEntries(probes.map(({ flagged: value, name }) => [name, value])),
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
