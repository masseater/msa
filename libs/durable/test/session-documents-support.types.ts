declare namespace sessionDocumentsSupportTypes {
  type Live = {
    message?: string;
    items: string[];
    nested: { count: number };
    other: { label: string };
  };

  type Counter = { count: number };

  type Member = { seed: string; hits: number };
}

export type { sessionDocumentsSupportTypes as default };
