import { expect, it } from "vite-plus/test";
import { createVitest } from "vite-plus/test/node";
import type { TestProject } from "vite-plus/test/node";

import viteConfig from "../../vite.config.ts";

const ROOT = `${import.meta.dirname}/../..`;
const PROJECT_FILTER = /^vp test run --project '([^']+)'$/u;

const tasks = viteConfig.run?.tasks ?? {};

const commandOf = (name: string): string => {
  const task = tasks[name];
  if (task === undefined || Array.isArray(task)) return "";
  return typeof task === "string" ? task : String(task.command);
};

const testTaskNames = (): ReadonlyArray<string> => {
  const test = tasks["test"];
  if (test === undefined || typeof test === "string" || Array.isArray(test)) return [];
  return (test.dependsOn ?? []).map((dep) => (typeof dep === "string" ? dep : dep.task));
};

const filters = testTaskNames().flatMap((name) => {
  const filter = PROJECT_FILTER.exec(commandOf(name))?.[1];
  return filter === undefined ? [] : [filter];
});

const matches = (filter: string, project: string): boolean =>
  new RegExp(
    `^${filter
      .split("*")
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join(".*")}$`,
    "u",
  ).test(project);

const problemsOf = (project: TestProject): Promise<ReadonlyArray<string>> =>
  project.globTestFiles().then(({ testFiles }) => {
    const owners = filters.filter((filter) => matches(filter, project.name));
    return [
      ...(testFiles.length === 0 ? [`${project.name} has no test files`] : []),
      ...(owners.length === 1
        ? []
        : [`${project.name} is run by ${owners.length} test tasks: ${owners.join(", ")}`]),
    ];
  });

it("runs every vitest project, each with test files, from exactly one task of test", () =>
  createVitest({ root: ROOT, run: true, watch: false }).then((vitest) =>
    Promise.all(vitest.projects.map(problemsOf))
      .then((problems) => ({ names: vitest.projects.map((project) => project.name), problems }))
      .finally(() => vitest.close())
      .then(({ names, problems }) => {
        expect(problems.flat()).toEqual([]);
        expect(names.length).toBeGreaterThan(0);
        return undefined;
      }),
  ));
