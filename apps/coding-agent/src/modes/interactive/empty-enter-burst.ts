export const EMPTY_ENTER_BURST_COUNT = 3;
export const EMPTY_ENTER_BURST_WINDOW_MS = 1000;

export type EmptyEnterBurst = {
  readonly count: number;
  readonly lastAt: number;
};

export const EMPTY_ENTER_BURST_IDLE: EmptyEnterBurst = { count: 0, lastAt: 0 };

export function registerEmptyEnter(
  burst: EmptyEnterBurst,
  now: number,
): { readonly burst: EmptyEnterBurst; readonly fire: boolean } {
  const continuing = burst.count > 0 && now - burst.lastAt <= EMPTY_ENTER_BURST_WINDOW_MS;
  const count = continuing ? burst.count + 1 : 1;
  if (count >= EMPTY_ENTER_BURST_COUNT) {
    return { burst: EMPTY_ENTER_BURST_IDLE, fire: true };
  }
  return { burst: { count, lastAt: now }, fire: false };
}
