declare namespace toolApiTypes {
  type ApiState = {
    readonly admissions: Promise<unknown>[];
    ended: boolean;
    sequence: number;
    madeNestedMemo: Promise<unknown> | undefined;
  };
}

export type { toolApiTypes as default };
