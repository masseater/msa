import { DateTime, Function } from "effect";

const formatInt = (value: number): string => new Intl.NumberFormat("en-US").format(value);

const formatPercent: {
  (total: number): (part: number) => string;
  (part: number, total: number): string;
} = Function.dual(2, (part: number, total: number): string =>
  total === 0 ? "n/a" : `${((part / total) * 100).toFixed(1)}%`,
);

const formatIsoMillis = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

const quantile: {
  (fraction: number): (numbers: ReadonlyArray<number | null>) => number | null;
  (numbers: ReadonlyArray<number | null>, fraction: number): number | null;
} = Function.dual(2, (numbers: ReadonlyArray<number | null>, fraction: number): number | null => {
  const finite = numbers
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finite.length === 0) return null;
  if (finite.length === 1) return finite[0] ?? null;
  const position = (finite.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = finite[lower] ?? 0;
  const high = finite[upper] ?? 0;
  return lower === upper ? low : low * (1 - (position - lower)) + high * (position - lower);
});

const median = (numbers: ReadonlyArray<number | null>): number | null => quantile(numbers, 0.5);

export { formatInt, formatIsoMillis, formatPercent, median, quantile };
