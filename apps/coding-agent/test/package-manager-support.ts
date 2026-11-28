import testing from "@msa/testing";
import { Effect } from "effect";

import type packageManagerTypes from "../src/core/package-manager.types.ts";

function normalizeForMatch(value: string): string {
  return value.replace(/\\/gu, "/");
}
const pathEndsWith = (actualPath: string, suffix: string): boolean =>
  normalizeForMatch(actualPath).endsWith(normalizeForMatch(suffix));
const isEnabled = (
  r: packageManagerTypes.ResolvedResource,
  pathMatch: string,
  matchFn: "endsWith" | "includes" = "endsWith",
) => {
  const normalizedPath = normalizeForMatch(r.path);
  const normalizedMatch = normalizeForMatch(pathMatch);
  return matchFn === "endsWith"
    ? normalizedPath.endsWith(normalizedMatch) && r.enabled
    : normalizedPath.includes(normalizedMatch) && r.enabled;
};
const isDisabled = (
  r: packageManagerTypes.ResolvedResource,
  pathMatch: string,
  matchFn: "endsWith" | "includes" = "endsWith",
) => {
  const normalizedPath = normalizeForMatch(r.path);
  const normalizedMatch = normalizeForMatch(pathMatch);
  return matchFn === "endsWith"
    ? normalizedPath.endsWith(normalizedMatch) && !r.enabled
    : normalizedPath.includes(normalizedMatch) && !r.enabled;
};
const packagePaths = { isDisabled, isEnabled, pathEndsWith };

const { dirnameOf, makeDirectory, writeTextFile } = testing;

const skillOf = (name: string, description: string, body = "Content"): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

const writeSkill = (file: string, name: string, description: string, body = "") =>
  Effect.gen(function* () {
    yield* makeDirectory(dirnameOf(file));
    yield* writeTextFile(file, skillOf(name, description, body));
  });

const packageManagerSupport = {
  normalizeForMatch,
  packagePaths,
  skillOf,
  writeSkill,
};

export default packageManagerSupport;
