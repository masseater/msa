import type { Brand } from "effect";

declare namespace htmlDocumentTypes {
  interface HtmlDocumentParts {
    readonly title: string;
    readonly style: string;
    readonly body: string;
    readonly lang?: string;
    readonly htmlAttributes?: Readonly<Record<string, string>>;
    readonly head?: string;
    readonly imageSources?: readonly string[];
  }

  type HtmlDocument = string & Brand.Brand<"HtmlDocument">;

  interface HtmlReply {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: HtmlDocument;
  }
}

export type { htmlDocumentTypes as default };
