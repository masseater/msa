import { quantile as d3Quantile } from "d3-array";
import { DateTime, Function } from "effect";

const formatInt = (value: number): string => new Intl.NumberFormat("en-US").format(value);

const formatPercent: {
  (total: number): (part: number) => string;
  (part: number, total: number): string;
} = Function.dual(2, (part: number, total: number): string =>
  total === 0 ? "n/a" : `${((part / total) * 100).toFixed(1)}%`,
);

const ratio: {
  (total: number): (part: number) => number | null;
  (part: number, total: number): number | null;
} = Function.dual(2, (part: number, total: number): number | null =>
  total === 0 ? null : part / total,
);

const formatIsoMillis = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

const quantile: {
  (fraction: number): (numbers: ReadonlyArray<number | null>) => number | null;
  (numbers: ReadonlyArray<number | null>, fraction: number): number | null;
} = Function.dual(
  2,
  (numbers: ReadonlyArray<number | null>, fraction: number): number | null =>
    d3Quantile(
      numbers.filter((value): value is number => value !== null && Number.isFinite(value)),
      fraction,
    ) ?? null,
);

const median = (numbers: ReadonlyArray<number | null>): number | null => quantile(numbers, 0.5);

export { formatInt, formatIsoMillis, formatPercent, median, quantile, ratio };
