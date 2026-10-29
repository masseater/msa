import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import testProcess from "./test-process.ts";

const { captureProcess, processRunnerLayer } = testProcess;

const repoRoot = `${import.meta.dirname}/../..`;
const htmlExitRule = `${repoRoot}/tools/rules/no-html-outside-html-document.yml`;
const runMainRule = `${repoRoot}/tools/rules/scripts-start-through-run-main.yml`;

const Matches = Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String })));

interface Case {
  readonly file: string;
  readonly source: string;
}

const SELF_CLOSING = '"<html/>"';
const HEAD_AND_BODY = '`<head><meta charset="utf-8"></head><body>${x}</body>`';

const CHECKS_SERVE =
  'export const r = (page) => new Response(page, { headers: { "content-type": "text/html" } });';
const CHECKS_WRITE = 'import { writeFileSync } from "node:fs";\nwriteFileSync("probe.html", page);';

const htmlOutputs: readonly Case[] = [
  { file: "tools/checks/probe-serve.ts", source: CHECKS_SERVE },
  { file: "tools/checks/probe-write.ts", source: CHECKS_WRITE },
  { file: "tools/checks/probe-serve.tsx", source: CHECKS_SERVE },
  { file: "tools/checks/probe-write.tsx", source: CHECKS_WRITE },
  { file: "tools/checks/probe-serve.mjs", source: CHECKS_SERVE },
  { file: "tools/checks/probe-write.mjs", source: CHECKS_WRITE },
  {
    file: "scripts/self-closing-file.ts",
    source: `import { writeFileSync } from "node:fs";\nwriteFileSync("report.html", ${SELF_CLOSING});`,
  },
  {
    file: "scripts/head-body-file.mjs",
    source: `export const w = (fs, dir, x) => fs.writeFileString(\`\${dir}/report.html\`, ${HEAD_AND_BODY});`,
  },
  {
    file: "libs/lib/src/self-closing-response.ts",
    source: `export const r = () => new Response(${SELF_CLOSING}, { headers: { "content-type": "text/html" } });`,
  },
  {
    file: "apps/app/src/head-body-reply.cts",
    source: `const reply = (x) => ({ body: ${HEAD_AND_BODY}, headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 });`,
  },
  {
    file: "scripts/variable-path.js",
    source:
      'import { writeFile } from "node:fs/promises";\nconst output = join(tmp, "msa-report.html");\nawait writeFile(output, page);',
  },
  {
    file: "tools/report.ts",
    source:
      'const defaults = { output: join(tmpdir(), "r.html") };\nexport const w = (host, args, page) => host.writeText(args.output, page);',
  },
  {
    file: ".msa/extensions/x/index.ts",
    source: 'let out;\nout = name + ".html";\nBun.write(out, page);',
  },
  {
    file: "apps/web/src/frame.tsx",
    source: "export const F = ({ x }) => <iframe src={`data:text/html,${x}`} />;",
  },
  { file: "libs/lib/src/legacy.mts", source: 'appendFileSync("old.htm", page);' },
  {
    file: "libs/lib/src/xhtml.jsx",
    source: 'export const b = (x) => new Blob([x], { type: "application/xhtml+xml" });',
  },
];

const notHtmlOutputs: readonly Case[] = [
  { file: "tools/checks/probe-serve.test.ts", source: CHECKS_SERVE },
  { file: "tools/checks/probe-write.test.ts", source: CHECKS_WRITE },
  { file: "tools/checks/probe-serve.test.tsx", source: CHECKS_SERVE },
  { file: "tools/checks/probe-write.test.mjs", source: CHECKS_WRITE },
  {
    file: "libs/ai/src/utils/html-document.ts",
    source:
      'const reply = (d) => ({ body: d, headers: { "content-type": "text/html" } });\nconst w = (fs, p, d) => fs.writeFileString(p, d);',
  },
  {
    file: "libs/lib/test/mock.test.ts",
    source: 'new Response("<html/>", { headers: { "content-type": "text/html" } });',
  },
  { file: "apps/app/test/fixtures/page.ts", source: 'writeFileSync("page.html", "<html/>");' },
  {
    file: ".msa/extensions/import/index.ts",
    source:
      'const isHtml = (p) => p.endsWith(".html");\nconst destination = join(dir, "s.jsonl");\nfs.writeFileString(destination, jsonl);',
  },
  {
    file: "apps/app/src/help.ts",
    source: "const EXAMPLES = `msa --export session.jsonl output.html`;",
  },
  {
    file: "scripts/report.ts",
    source:
      'const defaults = { output: join(tmpdir(), "r.html") };\nexport const w = (args, page) => writeHtmlFile(args.output, page);',
  },
  {
    file: "libs/lib/src/plain.ts",
    source:
      'export const r = () => new Response("<html/>", { headers: { "content-type": "text/plain" } });',
  },
  {
    file: "libs/lib/src/names.ts",
    source: 'writeFileSync("index.htmlx", x);\nwriteFileSync("a.jsonl", y);',
  },
];

const directRuns: readonly Case[] = [
  { file: "scripts/j.ts", source: "NodeRuntime.runMain(Console.log(page));" },
  { file: "tools/k.js", source: "Effect.runPromise(Console.log(page));" },
  { file: "libs/ai/scripts/l.ts", source: "ManagedRuntime.make(layer).runFork(program);" },
  { file: "apps/coding-agent/scripts/m.tsx", source: "runtime.runSync(program);" },
];

const runsThroughRunMainWith: readonly Case[] = [
  { file: "scripts/main.ts", source: "runMainWith(program, layer);" },
  { file: "libs/ai/src/utils/script-output.ts", source: "NodeRuntime.runMain(main);" },
  { file: "scripts/x.test.ts", source: "Effect.runPromise(program);" },
  { file: "apps/app/src/main.ts", source: "Effect.runPromise(program);" },
];

const probeRuntime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const reportedFiles = (rule: string, cases: readonly Case[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "msa-html-exit-rule-" });
      for (const { file, source } of cases) {
        yield* fs.makeDirectory(`${root}/${file.slice(0, file.lastIndexOf("/"))}`, {
          recursive: true,
        });
        yield* fs.writeFileString(`${root}/${file}`, `${source}\n`);
      }
      const { stdout } = yield* captureProcess({
        args: [
          "scan",
          "--rule",
          rule,
          "--json=compact",
          "apps",
          "libs",
          "scripts",
          "tools",
          ".msa",
        ],
        command: `${repoRoot}/node_modules/.bin/ast-grep`,
        cwd: root,
      });
      const matches = yield* Schema.decodeEffect(Matches)(stdout);
      return [...new Set(matches.map((match) => match.file))].toSorted();
    }),
  );

const expectReported = (rule: string, cases: readonly Case[], expected: readonly string[]) => () =>
  probeRuntime.runPromise(
    Effect.gen(function* () {
      expect(yield* reportedFiles(rule, cases)).toEqual([...expected].toSorted());
    }),
  );

it(
  "reports .html files written and text/html served outside the html-document exits",
  expectReported(
    htmlExitRule,
    htmlOutputs,
    htmlOutputs.map((entry) => entry.file),
  ),
);

it(
  "passes the exits themselves, tests, and writes that do not name an HTML file",
  expectReported(htmlExitRule, notHtmlOutputs, []),
);

it(
  "reports script entries that start a runtime without runMainWith",
  expectReported(
    runMainRule,
    directRuns,
    directRuns.map((entry) => entry.file),
  ),
);

it(
  "passes runMainWith, the script-output module itself, tests, and app code",
  expectReported(runMainRule, runsThroughRunMainWith, []),
);
