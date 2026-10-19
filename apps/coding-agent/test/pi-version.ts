import { Function } from "effect";

const PI_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

type ParsedPiVersion = readonly [major: number, minor: number, patch: number, prerelease: string];

function requirePiVersion(version: string): ParsedPiVersion {
  const parsed = parsePiVersion(version);
  if (parsed === undefined) {
    throw new Error(`Invalid Pi version: ${version}`);
  }
  return parsed;
}

function parsePiVersion(version: string): ParsedPiVersion | undefined {
  const match = PI_VERSION_RE.exec(version.trim());
  if (match === null) {
    return undefined;
  }
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (parsed.some((part) => !Number.isSafeInteger(part))) {
    return undefined;
  }
  return [parsed[0], parsed[1], parsed[2], match[4] ?? ""];
}

const CORE_VERSION_INDICES = [0, 1, 2] as const;

const NUMERIC_IDENTIFIER = /^\d+$/u;

function compareCoreVersions(left: ParsedPiVersion, right: ParsedPiVersion): number {
  const index = CORE_VERSION_INDICES.find((position) => left[position] !== right[position]);
  return index === undefined ? 0 : left[index] - right[index];
}

function compareDistinctIdentifiers(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const kindOrder = Number(NUMERIC_IDENTIFIER.test(right)) - Number(leftNumeric);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  return leftNumeric ? Number(left) - Number(right) : left.localeCompare(right);
}

function compareIdentifiers(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return compareDistinctIdentifiers(left, right);
}

function comparePrereleaseIdentifiers(
  leftParts: ReadonlyArray<string>,
  rightParts: ReadonlyArray<string>,
): number {
  const length = Math.max(leftParts.length, rightParts.length);
  const index = Array.from({ length }, (_, position) => position).find(
    (position) => leftParts[position] !== rightParts[position],
  );
  return index === undefined ? 0 : compareIdentifiers(leftParts[index], rightParts[index]);
}

function comparePrereleases(left: string, right: string): number {
  if (left === right) return 0;
  if (left === "") return 1;
  if (right === "") return -1;
  return comparePrereleaseIdentifiers(left.split("."), right.split("."));
}

const comparePiVersions: {
  (right: ParsedPiVersion): (left: ParsedPiVersion) => number;
  (left: ParsedPiVersion, right: ParsedPiVersion): number;
} = Function.dual(2, (left: ParsedPiVersion, right: ParsedPiVersion): number => {
  const core = compareCoreVersions(left, right);
  return core === 0 ? comparePrereleases(left[3], right[3]) : core;
});

export type { ParsedPiVersion };
export { comparePiVersions, parsePiVersion, requirePiVersion };
