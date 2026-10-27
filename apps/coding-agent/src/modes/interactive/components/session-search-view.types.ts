import type sessionSearchTypes from "../../../core/session-search/session-search.types.ts";

declare namespace sessionSearchViewTypes {
  interface SessionSearchViewOptions {
    search: (query: string) => Promise<sessionSearchTypes.Hit[]>;
    read: (request: {
      path: string;
      entry: string;
      from: number;
    }) => Promise<sessionSearchTypes.Page | undefined>;
    initialQuery: string | undefined;
    onClose: () => void;
    requestRender: () => void;
    maxHeight: () => number;
  }

  interface OpenPage {
    hit: sessionSearchTypes.Hit;
    path: string;
    text: string;
    next: sessionSearchTypes.Page["next"];
  }
}

export type { sessionSearchViewTypes as default };
