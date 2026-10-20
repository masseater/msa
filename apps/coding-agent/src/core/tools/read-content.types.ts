import type aiTypes from "@msa/ai/index.types";
import type { Static } from "typebox";

import type readContent from "./read-content.ts";
import type truncateTypes from "./truncate.types.ts";

declare namespace readContentTypes {
  type ReadToolInput = Static<typeof readContent.readSchema>;

  type ReadToolOutput = Static<typeof readContent.readOutputSchema>;

  interface ReadToolDetails {
    truncation?: truncateTypes.TruncationResult;
  }

  interface ReadOperations {
    readFile: (absolutePath: string) => Promise<Buffer>;
    access: (absolutePath: string) => Promise<void>;
    detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
  }

  interface ReadToolOptions {
    autoResizeImages?: boolean;
    resizeOptions?: aiTypes.ModelImageResizeOptions;
    operations?: ReadOperations;
  }

  interface ImageReadInput {
    ops: ReadOperations;
    absolutePath: string;
    mimeType: string;
    autoResizeImages: boolean;
    resizeOptions: aiTypes.ModelImageResizeOptions | undefined;
    model: aiTypes.Model<aiTypes.Api> | undefined;
  }

  interface TextReadInput {
    buffer: Buffer;
    path: string;
    offset: number | undefined;
    limit: number | undefined;
  }
}

export type { readContentTypes as default };
