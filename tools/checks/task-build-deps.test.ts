import { expect, it } from "vite-plus/test";

import taskBuildDeps from "./task-build-deps.ts";
import taskGraph from "./task-graph.ts";

const { violationsOf } = taskBuildDeps;
const { loadTasks } = taskGraph;

it("makes every task that runs workspace packages from dist depend on build", () =>
  expect(violationsOf(loadTasks())).resolves.toEqual([]));

const ENTRY = "apps/coding-agent/test/mcp-conformance/run.ts";
const FIXTURES = "tools/checks/fixtures/task-build-deps";
const READS_DIST = "@msa/chord/sleep resolves to @msa/chord/dist/sleep.js";
const UNKNOWN_ENTRY = "cannot find the entry";
const SCRIPTS = { "case-entry": `node ${ENTRY}` };

const caseTask = (command: string, dependsOn: ReadonlyArray<string>) => ({
  case: { command, cwd: ".", dependsOn },
});

it.each([
  ["plain node", `node ${ENTRY}`, READS_DIST],
  ["an env assignment", `MSA_FLAG=1 node ${ENTRY}`, READS_DIST],
  ["env", `env MSA_FLAG=1 node ${ENTRY}`, READS_DIST],
  ["/usr/bin/env", `/usr/bin/env node ${ENTRY}`, READS_DIST],
  ["vp exec", `vp exec node ${ENTRY}`, READS_DIST],
  ["pnpm exec", `pnpm exec node ${ENTRY}`, READS_DIST],
  ["npx", `npx node ${ENTRY}`, READS_DIST],
  ["a node option that takes a value", `node --env-file-if-exists .env ${ENTRY}`, READS_DIST],
  ["a node option with an inline value", `node --env-file-if-exists=.env ${ENTRY}`, READS_DIST],
  ["pnpm run", "pnpm run case-entry", READS_DIST],
  ["a pnpm script by name", "pnpm case-entry", READS_DIST],
  ["npm run", "npm run case-entry", READS_DIST],
  ["bash and a script file", `bash ${FIXTURES}/runs-entry.sh`, READS_DIST],
  ["sh and a script file", `sh ${FIXTURES}/runs-entry.sh`, READS_DIST],
  ["bash -c", `bash -c "node ${ENTRY}"`, READS_DIST],
  ["a subshell", `(node ${ENTRY})`, READS_DIST],
  ["a command substitution", `echo "$(node ${ENTRY})"`, READS_DIST],
  ["the second half of a pipeline", `echo | node ${ENTRY}`, READS_DIST],
  ["cd before node", "cd apps/coding-agent && node test/mcp-conformance/run.ts", READS_DIST],
  ["a build that may not have run", `vp run build || node ${ENTRY}`, READS_DIST],
  [
    "a node child process that does not get --conditions",
    `node --conditions=source ${FIXTURES}/starts-child.ts`,
    `starts ${FIXTURES}/child.ts in a node process, which does not inherit --conditions or --import: ${FIXTURES}/child.ts: ${READS_DIST}`,
  ],
  ["an option node does not have", `node --msa-unknown ${ENTRY}`, UNKNOWN_ENTRY],
  ["code instead of a file", `node -e "import('${ENTRY}')"`, UNKNOWN_ENTRY],
  ["an entry from a variable", "node $ENTRY", UNKNOWN_ENTRY],
  [
    "node behind a wrapper option",
    `npx --yes node ${ENTRY}`,
    "does not know whether npx reads dist",
  ],
  [
    "a program this check does not know",
    `msa-unknown ${ENTRY}`,
    "does not know whether msa-unknown",
  ],
  ["a program from a variable", `$RUNNER ${ENTRY}`, "the program comes from $RUNNER"],
  ["NODE_OPTIONS", `NODE_OPTIONS=--conditions=source node ${ENTRY}`, "does not read NODE_OPTIONS"],
  ["an if statement", `if true; then node ${ENTRY}; fi`, "cannot read if_statement"],
  ["a shell script with syntax this check cannot read", "bash test.sh", "cannot read"],
  ["a vp run option this check does not know", "vp run --msa-unknown case-entry", "--msa-unknown"],
])(
  "flags a task that runs the entry through %s unless it depends on build",
  (_, command, problem) => {
    const found = violationsOf(caseTask(command, []), SCRIPTS);
    const outsideTheTask = found.then((violations) =>
      violations.filter((violation) => !violation.startsWith("msa-monorepo#case")),
    );
    return Promise.all([
      expect(found).resolves.toEqual(expect.arrayContaining([expect.stringContaining(problem)])),
      expect(outsideTheTask).resolves.toEqual([]),
      expect(violationsOf(caseTask(command, ["build"]), SCRIPTS)).resolves.toEqual([]),
    ]).then(() => undefined);
  },
);

it.each([
  [
    "cd before node with the source resolver",
    "cd apps/coding-agent && node --import ./src/experimental/source-resolver.ts test/mcp-conformance/run.ts",
  ],
  ["a build earlier in the same command", `vp run build && node ${ENTRY}`],
])("passes a task that runs the entry through %s", (_, command) =>
  expect(violationsOf(caseTask(command, []), SCRIPTS)).resolves.toEqual([]),
);
