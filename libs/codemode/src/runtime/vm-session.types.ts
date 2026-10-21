declare namespace vmSessionTypes {
  interface VirtualClock {
    creating: boolean;
    startedAt: number;
    now: number;
    seed: number;
  }
}

export type { vmSessionTypes as default };
