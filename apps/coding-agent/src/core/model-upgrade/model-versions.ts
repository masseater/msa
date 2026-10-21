import type modelUpgradeTypes from "../model-upgrade.types.ts";

type ModelIdVersion = modelUpgradeTypes.ModelIdVersion;

const VERSION_PATTERN = /(?<![A-Za-z0-9.])v?(\d{1,2}(?![0-9])(?:[.-]\d{1,2}(?![0-9]))*)/u;
const DATE_PATTERN = /^\d{4,8}$/u;
const TOKEN_SEPARATOR = /[-_.\s]+/u;

function parseModelIdVersion(id: string): ModelIdVersion | undefined {
  const match = VERSION_PATTERN.exec(id);
  if (match === null) return undefined;
  const family = id
    .slice(0, match.index)
    .replace(/[-_.\s]+$/u, "")
    .toLowerCase();
  const version = match[1]!.split(/[.-]/u).map(Number);
  if (family === "" || version.some((part) => Number.isNaN(part))) return undefined;
  const tokens = id
    .slice(match.index + match[0].length)
    .split(TOKEN_SEPARATOR)
    .filter(Boolean);
  const last = tokens[tokens.length - 1];
  const date = last !== undefined && DATE_PATTERN.test(last) ? tokens.pop() : undefined;
  return {
    date: date?.toLowerCase(),
    family,
    variant: tokens.join("-").toLowerCase(),
    version,
  };
}

function compareModelVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

function compareDates(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : 1;
}

function describeReason(from: ModelIdVersion, to: ModelIdVersion): string {
  const versionChange = compareModelVersions(from.version, to.version);
  if (versionChange < 0) {
    return `version ${from.version.join(".")} to ${to.version.join(".")}`;
  }
  if (versionChange > 0) {
    return `version ${from.version.join(".")} is newer than ${to.version.join(".")}`;
  }
  if (from.date === undefined && to.date !== undefined) {
    return `dated variant ${to.date}`;
  }
  return `dated variant ${from.date ?? "none"} to ${to.date ?? "none"}`;
}

const modelVersions = { compareDates, compareModelVersions, describeReason, parseModelIdVersion };

export default modelVersions;
