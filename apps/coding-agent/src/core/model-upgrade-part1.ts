import type aiTypes from "@msa/ai/index.types";
import type typesModulePart1 from "@msa/ai/types-part1.types";

import type modelUpgradeTypes from "./model-upgrade.types.ts";

const VERSION_PATTERN = /(?<![A-Za-z0-9.])v?(\d{1,2}(?![0-9])(?:[.-]\d{1,2}(?![0-9]))*)/u;

const DATE_PATTERN = /^\d{4,8}$/u;

const TOKEN_SEPARATOR = /[-_.\s]+/u;

function parseModelIdVersion(id: string): modelUpgradeTypes.ModelIdVersion | undefined {
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

function describeReason(
  from: modelUpgradeTypes.ModelIdVersion,
  to: modelUpgradeTypes.ModelIdVersion,
): string {
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

function familyKey(
  model: aiTypes.Model<aiTypes.Api>,
  parsed: modelUpgradeTypes.ModelIdVersion,
): string {
  return [model.provider, parsed.family, parsed.variant].join("\u0000");
}

function findModelUpgradesPart14(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart13(parsed, byFamily);
}

function findModelUpgradesPart13(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart12(parsed, byFamily);
}

function findModelUpgradesPart12(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart11(parsed, byFamily);
}

function findModelUpgradesPart11(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart10(parsed, byFamily);
}

function findModelUpgradesPart10(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart9(parsed, byFamily);
}

function findModelUpgradesPart9(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart8(parsed, byFamily);
}

function findModelUpgradesPart8(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart7(parsed, byFamily);
}

function findModelUpgradesPart7(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart6(parsed, byFamily);
}

function findModelUpgradesPart6(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart5(parsed, byFamily);
}

function findModelUpgradesPart5(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart4(parsed, byFamily);
}

function findModelUpgradesPart4(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart3(parsed, byFamily);
}

function findModelUpgradesPart3(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart2(parsed, byFamily);
}

function findModelUpgradesPart2(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart1(parsed, byFamily);
}

function findModelUpgradesPart1(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
) {
  const newestFirst = (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>): number => {
    const left = parsed.get(a)!;
    const right = parsed.get(b)!;
    return compareModelVersions(right.version, left.version) || compareDates(right.date, left.date);
  };

  const reference = (model: aiTypes.Model<aiTypes.Api>): string => `${model.provider}/${model.id}`;
  const candidates: modelUpgradeTypes.ModelUpgradeCandidate[] = [];
  const reported = new Set<string>();
  for (const family of byFamily.values()) {
    const ordered = [...family].sort(newestFirst);
    const newest = ordered[0]!;
    const newestVersion = parsed.get(newest)!;
    for (const model of ordered.slice(1)) {
      const version = parsed.get(model)!;
      candidates.push({
        confident: true,
        from: model,
        reason: describeReason(version, newestVersion),
        to: newest,
      });
      reported.add(reference(model));
    }
  }
  return { candidates, newestFirst, reference, reported };
}

const modelUpgradePart1 = {
  compareModelVersions,
  describeReason,
  familyKey,
  findModelUpgradesPart14,
  parseModelIdVersion,
};

export default modelUpgradePart1;
