declare namespace outputTypes {
  type OutputFile = (
    name: string,
    data: string | Uint8Array,
  ) => Promise<{ path: string } | { error: string }>;
}

export type { outputTypes as default };
