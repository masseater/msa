import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import docsCatalog from "./docs-catalog.ts";

const {
  dirnameOf,
  isAbsolutePath,
  pathExists,
  readDirectoryRecursive,
  readJsonFile,
  readTextFile,
  relativePath,
  resolvePath,
  runTest,
} = testing;

const { fragmentOf, markdownAnchors, markdownLinks, navigationPaths, publicSlug, readNavigation } =
  docsCatalog;

const docsRoot = resolvePath(import.meta.dirname, "../docs");

const loadPages = Effect.fn("loadPages")(function* () {
  const paths = (yield* readDirectoryRecursive(docsRoot))
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".md"))
    .sort();
  const contents = yield* Effect.forEach(paths, (path) =>
    readTextFile(resolvePath(docsRoot, path)),
  );
  return new Map(paths.map((path, index) => [path, contents[index] ?? ""]));
});

const slugCollisionsOf = (pages: readonly string[]): string[] => {
  const pathsBySlug = new Map<string, string[]>();
  for (const path of pages) {
    const slug = publicSlug(path);
    pathsBySlug.set(slug, [...(pathsBySlug.get(slug) ?? []), path]);
  }
  return [...pathsBySlug]
    .filter(([, paths]) => paths.length > 1)
    .map(([slug, paths]) => `${slug || "/"} (${paths.join(", ")})`)
    .sort();
};

const isExternal = (href: string) =>
  /^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith("//") || href.startsWith("/");

const insideDocs = (target: string): string | undefined => {
  const relative = relativePath(docsRoot, target);
  if (relative === ".." || relative.startsWith("..") || isAbsolutePath(relative)) return undefined;
  return relative.replaceAll("\\", "/");
};

const checkLink = Effect.fn("checkLink")(function* (
  pages: ReadonlyMap<string, string>,
  source: string,
  href: string,
) {
  const linkedPath = href.split(/[?#]/u, 1)[0] ?? "";
  const fragment = fragmentOf(href);
  if (linkedPath === "") {
    const ok = fragment === "" || markdownAnchors(pages.get(source) ?? "").has(fragment);
    return { broken: !ok, next: undefined };
  }
  if (!linkedPath.endsWith(".md")) return { broken: false, next: undefined };
  const target = resolvePath(docsRoot, dirnameOf(source), linkedPath);
  const inside = insideDocs(target);
  const content = inside === undefined ? undefined : pages.get(inside);
  if (content === undefined) return { broken: !(yield* pathExists(target)), next: undefined };
  return { broken: fragment !== "" && !markdownAnchors(content).has(fragment), next: inside };
});

const walkLinks = Effect.fn("walkLinks")(function* (
  pages: ReadonlyMap<string, string>,
  roots: readonly string[],
) {
  const reachable = new Set<string>();
  const pending = roots.filter((path) => pages.has(path));
  const brokenLinks: string[] = [];
  while (pending.length > 0) {
    const source = pending.shift();
    if (source === undefined || reachable.has(source)) continue;
    reachable.add(source);
    for (const href of markdownLinks(pages.get(source) ?? "")) {
      if (isExternal(href)) continue;
      const { broken, next } = yield* checkLink(pages, source, href);
      if (broken) brokenLinks.push(`${source} -> ${href}`);
      if (next !== undefined && !reachable.has(next)) pending.push(next);
    }
  }
  return { brokenLinks, reachable };
});

const issue = (label: string, items: readonly string[], separator = ", ") =>
  items.length > 0 ? [`${label}: ${items.join(separator)}`] : [];

const hasValidNavigationAndNoOrphanedMarkdown = Effect.gen(function* () {
  const pages = yield* loadPages();
  const allPages = [...pages.keys()];
  const roots = navigationPaths(
    readNavigation(yield* readJsonFile(resolvePath(docsRoot, "docs.json"))),
  );
  const duplicateRoots = [
    ...new Set(roots.filter((path, index) => roots.indexOf(path) !== index)),
  ].sort();
  const missingRoots = roots.filter((path) => !pages.has(path)).sort();
  const { brokenLinks, reachable } = yield* walkLinks(pages, roots);
  const issues = [
    ...issue("Duplicate navigation paths", duplicateRoots),
    ...issue("Missing navigation pages", missingRoots),
    ...issue("Broken local Markdown links", brokenLinks.sort()),
    ...issue("Duplicate public documentation slugs", slugCollisionsOf(allPages), "; "),
    ...issue(
      "Orphaned Markdown pages",
      allPages.filter((path) => !reachable.has(path)),
    ),
  ];
  expect(issues).toEqual([]);
});

describe("coding-agent documentation", () => {
  it("has valid navigation and no orphaned Markdown pages", () =>
    runTest(hasValidNavigationAndNoOrphanedMarkdown));
});
