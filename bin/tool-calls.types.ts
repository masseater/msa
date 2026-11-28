declare namespace toolCallsTypes {
  type Block = Readonly<Record<string, unknown>>;

  interface CallMessage {
    readonly api?: string | undefined;
    readonly content?: string | ReadonlyArray<Block> | undefined;
    readonly model?: string | undefined;
    readonly provider?: string | undefined;
    readonly role?: string | undefined;
  }

  interface CallOrigin {
    readonly sessionFile: string;
    readonly assistantEntryId: string | undefined;
    readonly timestamp: string | undefined;
    readonly api: string | null;
    readonly provider: string;
    readonly model: string;
    readonly providerModel: string;
  }
}

export type { toolCallsTypes as default };
