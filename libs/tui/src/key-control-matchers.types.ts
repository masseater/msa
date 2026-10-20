declare namespace keyControlMatchersTypes {
  interface KeyMatchRequest {
    readonly key: string;
    readonly data: string;
    readonly modifier: number;
  }
}

export type { keyControlMatchersTypes as default };
