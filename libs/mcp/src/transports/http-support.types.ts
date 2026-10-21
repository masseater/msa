declare namespace httpSupportTypes {
  interface StreamCursor {
    lastEventId: string | undefined;
    retryMs: number | undefined;
    received: boolean;
  }
}

export type { httpSupportTypes as default };
