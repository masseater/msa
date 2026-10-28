import { expect, it } from "vite-plus/test";

import lintConfig from "../../lint.config.ts";
import lintProbe from "./lint-probe.ts";
import typedAccess from "./typed-access.ts";

const { processEnvWriter } = lintConfig;
const { lintAndInspectProbes, probePath } = lintProbe;

const HEADER = [
  "declare const values: Readonly<Record<string, string>>;",
  "declare const other: Readonly<Record<string, string>>;",
];

const WRITE = "for (const name of Object.keys(values)) process.env[name] = String(values[name]);";

const writerVariants: Readonly<Record<string, string>> = {
  blockBody:
    "for (const name of Object.keys(values)) { process.env[name] = String(values[name]); }",
  compound: "for (const name of Object.keys(values)) process.env[name] += String(values[name]);",
  dotWrite: 'process.env.FOO = "1";',
  entries: "for (const [name, value] of Object.entries(values)) process.env[name] = String(value);",
  forIn: "for (const name in values) process.env[name] = String(values[name]);",
  keysOfOther: "for (const name of Object.keys(other)) process.env[name] = String(values[name]);",
  letLoop: "for (let name of Object.keys(values)) process.env[name] = String(values[name]);",
  literalRead: 'void process.env["HOME"];',
  otherKey: "for (const name of Object.keys(values)) process.env[name] = String(values.FOO);",
  withoutString: 'for (const name of Object.keys(values)) process.env[name] = values[name] ?? "";',
};

const variantNames = Object.keys(writerVariants);

const writerSource = [...HEADER, WRITE, ...Object.values(writerVariants), "export {};", ""].join(
  "\n",
);

const SANCTIONED_LINE = HEADER.length + 1;

const lineOf = (name: string): number => SANCTIONED_LINE + 1 + variantNames.indexOf(name);

const elsewhere = [
  "apps/coding-agent/src/core/platform/node",
  "apps/coding-agent/src/core/platform",
  "apps/coding-agent/src/bun",
  "apps/coding-agent/test",
  "libs/agent/src",
  "tools/checks",
].map((dir) => probePath(dir, "process-env-write"));

const elsewhereSource = [...HEADER, WRITE, "export {};", ""].join("\n");

const ENV_RULES = new Set(["effecttsgo(process-env)", "msa(process-env-writer)"]);

it("lets only the platform env writer assign process.env, and only in its one loop form", () =>
  lintAndInspectProbes(
    {
      [processEnvWriter]: writerSource,
      ...Object.fromEntries(elsewhere.map((path) => [path, elsewhereSource])),
    },
    (run) => typedAccess.scan({ files: (name) => name.startsWith(`${run}/`), root: run }),
  ).then(({ diagnostics, inspected }) => {
    const lintedOn = (file: string, line: number): boolean =>
      diagnostics.some(
        (diagnostic) =>
          diagnostic.filename === file &&
          diagnostic.labels[0]?.span.line === line &&
          ENV_RULES.has(diagnostic.code),
      );
    const keyOn = (file: string, line: number): boolean =>
      inspected.some(
        (finding) =>
          finding.file === file && finding.line === line && finding.rule === "computed-key",
      );
    expect({
      elsewhere: Object.fromEntries(
        elsewhere.map((path) => [
          path,
          { key: keyOn(path, SANCTIONED_LINE), lint: lintedOn(path, SANCTIONED_LINE) },
        ]),
      ),
      variants: Object.fromEntries(
        variantNames.map((name) => [name, lintedOn(processEnvWriter, lineOf(name))]),
      ),
      writer: {
        key: keyOn(processEnvWriter, SANCTIONED_LINE),
        lint: lintedOn(processEnvWriter, SANCTIONED_LINE),
      },
    }).toEqual({
      elsewhere: Object.fromEntries(elsewhere.map((path) => [path, { key: true, lint: true }])),
      variants: Object.fromEntries(variantNames.map((name) => [name, true])),
      writer: { key: false, lint: false },
    });
    return undefined;
  }));
