export function* range(start: number, end: number, step = 1): Generator<number> {
  for (let value = start; value < end; value += step) yield value;
}
