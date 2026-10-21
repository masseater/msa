import type typesModule from "../types.types.ts";

declare namespace systemOneSharedTypes {
  interface SystemOneWireRequest {
    state: typesModule.ClassifierContext["state"];
    questions: Record<string, unknown>;
  }

  interface SystemOneTransport {
    api: typesModule.ClassifierApi;
    label: string;
    url(model: typesModule.ClassifierModel<typesModule.ClassifierApi>): URL;
    payload(
      model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
      request: SystemOneWireRequest,
    ): unknown;
    output(body: unknown): Record<string, unknown>;
  }
}

export type { systemOneSharedTypes as default };
