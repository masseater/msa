import type typesModule from "../types.types.ts";

declare namespace classifierSharedTypes {
  interface ClassifierHttpError extends Error {
    status: number | undefined;
    headers: Headers | undefined;
    body: string;
  }

  interface ClassifierRequest {
    readonly label: string;
    readonly url: URL;
    readonly model: typesModule.ClassifierModel<typesModule.ClassifierApi>;
    readonly body: unknown;
    readonly options: typesModule.ClassifierOptions | undefined;
    readonly noRetryStatuses?: readonly number[] | undefined;
  }
}

export type { classifierSharedTypes as default };
