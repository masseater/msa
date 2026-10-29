import { expect, it } from "vite-plus/test";

import embeddedScript from "./embedded-script.ts";
import lintProbe from "./lint-probe.ts";
import localTimeCheck from "./local-time.ts";

const { lintAndInspectProbes, listRepoFiles, probePath, readRepoFile, repoRoot } = lintProbe;

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

const scriptCases: Readonly<Record<string, readonly [statement: string, flagged: boolean]>> = {
  getTime: ["const v = new Date(0).getTime();", false],
  localeString: ["const v = new Date(0).toLocaleString();", true],
  localeTime: ["const date = new Date(0);\nconst v = date.toLocaleTimeString();", true],
};

const SCRIPT_DIR = "apps/coding-agent/src/core/export-html";

const scriptProbes = Object.entries(scriptCases).map(([name, [statement, flagged]]) => ({
  flagged,
  name,
  path: `${SCRIPT_DIR}/local-time-${name}-probe.js`,
  source: `${statement}\nconsole.log(v);\n`,
}));

const extractedScript = {
  path: "scripts/local-time-extracted-probe.js",
  source: "console.log(new Date(0).toLocaleString());\n",
};

const TAG = "script";
const ON = "on";
const SCHEME = "javascript";
const LOCALE = "new Date().toLocaleString()";

const embeddedCases: Readonly<Record<string, readonly [statement: string, flagged: boolean]>> = {
  concatScript: [`export const v = (js: string) => "<${TAG}>" + js + "</${TAG}>";`, true],
  constantScript: [`const JS = "${LOCALE}";\nexport const v = \`<${TAG}>\${JS}</${TAG}>\`;`, true],
  dataScript: [
    `export const v = (json: string) => \`<${TAG} type="application/json">\${json}</${TAG}>\`;`,
    false,
  ],
  handler: [`export const v = '<button ${ON}click="this.textContent=${LOCALE}">';`, true],
  handlerConcat: [`export const v = "<button" + ' ${ON}click="${LOCALE}">';`, true],
  schemeCheck: [`export const v = (p: string) => ["${SCHEME}:", "data:"].includes(p);`, false],
  schemeUrl: [`export const v = '<a href="${SCHEME}:alert(${LOCALE})">';`, true],
  srcScript: [`export const v = '<${TAG} src="https://example.com/a.js"></${TAG}>';`, false],
  stringLocale: [`export const v = "<${TAG}>${LOCALE}</${TAG}>";`, true],
  substitutedScript: [
    "export const v = (js: string) => `<" + TAG + ">\n${js}\n</" + TAG + ">`;",
    true,
  ],
  templateLocale: [
    `export const v = (n: number) => \`<${TAG}>const n=\${n};${LOCALE}</${TAG}>\`;`,
    true,
  ],
  typeFromVariable: [
    `export const v = (t: string, js: string) => \`<${TAG} type="\${t}">\${js}</${TAG}>\`;`,
    true,
  ],
};

const embeddedProbes = Object.entries(embeddedCases).map(([name, [statement, flagged]]) => ({
  flagged,
  name,
  path: probePath("scripts", `local-time-embedded-${name}`),
  source: `${statement}\n`,
}));

const scriptOwner = {
  path: localTimeCheck.SCRIPT_OWNER,
  source: `export const v = (js: string) => \`<${TAG}>\${js}</${TAG}>\`;\n`,
};

const [owner] = localTimeCheck.OWNERS;

it("reports every way of reading the local time zone outside the one formatter", () =>
  readRepoFile(localTimeCheck.BROWSER_SCRIPTS).then((browserScripts) =>
    lintAndInspectProbes(
      {
        ...Object.fromEntries(
          [...probes, ...scriptProbes, ...embeddedProbes, extractedScript, scriptOwner].map(
            ({ path, source }) => [path, source],
          ),
        ),
        [localTimeCheck.BROWSER_SCRIPTS]: browserScripts,
        [owner!]: [...HEADER, "export const v = date.getHours();", ""].join("\n"),
      },
      (run) => {
        const scope = { files: (name: string) => name.startsWith(`${run}/`), root: run };
        return {
          all: localTimeCheck.scan(scope),
          withoutEmbedded: localTimeCheck.scan(scope, new Set(["embeddedScript"])),
        };
      },
    ).then(({ inspected: { all, withoutEmbedded } }) => {
      const flaggedIn = (findings: typeof all) => (path: string) =>
        findings.some((finding) => finding.file === path);
      const flagged = flaggedIn(all);
      const embedded = (found: (path: string) => boolean) =>
        Object.fromEntries(embeddedProbes.map(({ name, path }) => [name, found(path)]));
      expect({
        embedded: embedded(flagged),
        embeddedWithoutRule: embedded(flaggedIn(withoutEmbedded)),
        extracted: flagged(extractedScript.path),
        owner: flagged(owner!),
        probes: Object.fromEntries(probes.map(({ name, path }) => [name, flagged(path)])),
        scriptOwner: flagged(scriptOwner.path),
        scripts: Object.fromEntries(scriptProbes.map(({ name, path }) => [name, flagged(path)])),
      }).toEqual({
        embedded: Object.fromEntries(
          embeddedProbes.map(({ flagged: value, name }) => [name, value]),
        ),
        embeddedWithoutRule: Object.fromEntries(embeddedProbes.map(({ name }) => [name, false])),
        extracted: true,
        owner: false,
        probes: Object.fromEntries(probes.map(({ flagged: value, name }) => [name, value])),
        scriptOwner: false,
        scripts: Object.fromEntries(scriptProbes.map(({ flagged: value, name }) => [name, value])),
      });
      return undefined;
    }),
  ));

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

const htmlCases: Readonly<Record<string, readonly [html: string, flagged: boolean]>> = {
  data: [`<${TAG} id="d" type="application/json">{"a":1}</${TAG}>`, false],
  handler: [`<div ${ON}click="${LOCALE}"></div>`, true],
  inline: [`<${TAG}>${LOCALE}</${TAG}>`, true],
  placeholder: [`<${TAG}>\n{{JS}}\n</${TAG}>`, false],
  scheme: [`<a href="${SCHEME}:${LOCALE}">x</a>`, true],
  src: [`<${TAG} src="a.js"></${TAG}>`, false],
};

it("reports browser JS written into HTML instead of a checked .js file", () => {
  const entries = Object.entries(htmlCases);
  expect(
    Object.fromEntries(
      entries.map(([name, [html]]) => [name, embeddedScript.inHtml(html).length > 0]),
    ),
  ).toEqual(Object.fromEntries(entries.map(([name, [, flagged]]) => [name, flagged])));
});

it("leaves no browser JS written into the repository's HTML", () =>
  listRepoFiles("*.html")
    .then((files) =>
      Promise.all(
        files
          .filter((file) => !file.includes("/vendor/"))
          .map((file) =>
            readRepoFile(file).then((html) =>
              embeddedScript.inHtml(html).map(({ detail, index }) => `${file}:${index} ${detail}`),
            ),
          ),
      ),
    )
    .then((found) => {
      expect(found.flat()).toEqual([]);
      return undefined;
    }));
