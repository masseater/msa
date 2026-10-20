import { dual } from "effect/Function";

import config from "../config.ts";
import platform from "../core/platform.ts";
import nodeFs from "../core/platform/node/fs.ts";
import type changelogTypes from "./changelog.types.ts";
import platformExtra from "./platform-extra.ts";

const { existsSync, readFileSync } = nodeFs;

const { posix } = platformExtra;
const { writeError } = platform;

const GITHUB_REPO = "masseater/msa";
const CHANGELOG_LINK_BASE_PATH = "apps/coding-agent";
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/iu;
const INLINE_MARKDOWN_LINK_RE = /(!?\[[^\]\n]+\]\()([^\s)]+)((?:\s+[^)]*)?\))/gu;

function entryVersion(entry: changelogTypes.ChangelogEntry): string {
  return `${entry.major}.${entry.minor}.${entry.patch}`;
}

function normalizeTag(version: string | changelogTypes.ChangelogEntry): string {
  const versionString = typeof version === "string" ? version : entryVersion(version);
  return versionString.startsWith("v") ? versionString : `v${versionString}`;
}

function splitLocalTarget(target: string): { fragment: string; pathPart: string; query: string } {
  const hashIndex = target.indexOf("#");
  const beforeHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : target.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");

  if (queryIndex === -1) {
    return { fragment, pathPart: beforeHash, query: "" };
  }

  return {
    fragment,
    pathPart: beforeHash.slice(0, queryIndex),
    query: beforeHash.slice(queryIndex),
  };
}

function normalizePathPart(value: string): string {
  return value.replaceAll("\\", "/");
}

function resolveRepositoryPath(targetPath: string): string | undefined {
  const normalizedTarget = normalizePathPart(targetPath);
  const joined = normalizedTarget.startsWith("/")
    ? posix.normalize(normalizedTarget.replace(/^\/+/u, ""))
    : posix.normalize(posix.join(CHANGELOG_LINK_BASE_PATH, normalizedTarget));

  if (joined === "." || joined.startsWith("../") || joined === "..") {
    return undefined;
  }

  return joined;
}

function isDirectoryTarget(originalPath: string, repositoryPath: string): boolean {
  if (originalPath.endsWith("/")) {
    return true;
  }

  const basename = posix.basename(repositoryPath);
  return !basename.includes(".");
}

function normalizeChangelogLinkTarget(target: string, tag: string): string {
  let canonicalTarget = target;
  const repoUrl = `https://github.com/${GITHUB_REPO}`;

  for (const route of ["blob", "tree"]) {
    for (const branch of ["main", "master"]) {
      const floatingRefPrefix = `${repoUrl}/${route}/${branch}/`;
      if (canonicalTarget.startsWith(floatingRefPrefix)) {
        canonicalTarget = `${repoUrl}/${route}/${tag}/${canonicalTarget.slice(floatingRefPrefix.length)}`;
      }
    }
  }

  if (
    canonicalTarget.startsWith("#") ||
    canonicalTarget.startsWith("//") ||
    URL_SCHEME_RE.test(canonicalTarget)
  ) {
    return canonicalTarget;
  }

  const { fragment, pathPart, query } = splitLocalTarget(canonicalTarget);
  if (pathPart === "") {
    return canonicalTarget;
  }

  const repositoryPath = resolveRepositoryPath(pathPart);
  if (repositoryPath === undefined || repositoryPath === "") {
    return canonicalTarget;
  }

  const route = isDirectoryTarget(pathPart, repositoryPath) ? "tree" : "blob";
  return `https://github.com/${GITHUB_REPO}/${route}/${tag}/${encodeURI(repositoryPath)}${query}${fragment}`;
}

function normalizeChangelogLinksImpl(
  markdown: string,
  version: string | changelogTypes.ChangelogEntry,
): string {
  const tag = normalizeTag(version);
  return markdown.replace(
    INLINE_MARKDOWN_LINK_RE,
    (_match, prefix, target, suffix) =>
      `${prefix}${normalizeChangelogLinkTarget(target, tag)}${suffix}`,
  );
}

const normalizeChangelogLinks: {
  (markdown: string, version: string | changelogTypes.ChangelogEntry): string;
  (version: string | changelogTypes.ChangelogEntry): (markdown: string) => string;
} = dual((args: IArguments) => args.length >= 2, normalizeChangelogLinksImpl);

function parseChangelog(changelogPath: string): changelogTypes.ChangelogEntry[] {
  if (!existsSync(changelogPath)) {
    return [];
  }

  try {
    const content = readFileSync(changelogPath, "utf-8");
    const lines = content.split("\n");
    const entries: changelogTypes.ChangelogEntry[] = [];

    let currentLines: string[] = [];
    let currentVersion: { major: number; minor: number; patch: number } | null = null;

    for (const line of lines) {
      if (line.startsWith("## ")) {
        if (currentVersion !== null && currentLines.length > 0) {
          entries.push({
            ...currentVersion,
            content: currentLines.join("\n").trim(),
          });
        }

        const versionMatch = line.match(/##\s+\[?(\d+)\.(\d+)\.(\d+)\]?/u);
        const [, major, minor, patch] = versionMatch ?? [];
        if (major !== undefined && minor !== undefined && patch !== undefined) {
          currentVersion = {
            major: Number.parseInt(major, 10),
            minor: Number.parseInt(minor, 10),
            patch: Number.parseInt(patch, 10),
          };
          currentLines = [line];
        } else {
          currentVersion = null;
          currentLines = [];
        }
      } else if (currentVersion !== null) {
        currentLines.push(line);
      }
    }

    return parseChangelogPart1(currentVersion, currentLines, entries);
  } catch (error) {
    writeError(`Warning: Could not parse changelog: ${error}`);
    return [];
  }
}

function parseChangelogPart1(
  currentVersion: { major: number; minor: number; patch: number } | null,
  currentLines: string[],
  entries: changelogTypes.ChangelogEntry[],
) {
  if (currentVersion !== null && currentLines.length > 0) {
    entries.push({
      ...currentVersion,
      content: currentLines.join("\n").trim(),
    });
  }

  return entries;
}

function compareVersions(
  v1: changelogTypes.ChangelogEntry,
  v2: changelogTypes.ChangelogEntry,
): number {
  if (v1.major !== v2.major) return v1.major - v2.major;
  if (v1.minor !== v2.minor) return v1.minor - v2.minor;
  return v1.patch - v2.patch;
}

function getNewEntriesImpl(
  entries: changelogTypes.ChangelogEntry[],
  lastVersion: string,
): changelogTypes.ChangelogEntry[] {
  const parts = lastVersion.split(".").map(Number);
  const last: changelogTypes.ChangelogEntry = {
    content: "",
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };

  return entries.filter((entry) => compareVersions(entry, last) > 0);
}

const getNewEntries: {
  (entries: changelogTypes.ChangelogEntry[], lastVersion: string): changelogTypes.ChangelogEntry[];
  (
    lastVersion: string,
  ): (entries: changelogTypes.ChangelogEntry[]) => changelogTypes.ChangelogEntry[];
} = dual((args: IArguments) => args.length >= 2, getNewEntriesImpl);

const changelog = {
  getChangelogPath: config.getChangelogPath,
  getNewEntries,
  normalizeChangelogLinks,
  parseChangelog,
};

export default changelog;
