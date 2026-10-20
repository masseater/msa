import type { Static } from "typebox";

import type wireSchemas from "./wire-schemas.ts";

declare namespace wireTypes {
  type RootRef = Static<typeof wireSchemas.RootRefSchema>;

  type WireError = Static<typeof wireSchemas.WireErrorSchema>;

  type WireReloadOptions = Static<typeof wireSchemas.WireReloadOptionsSchema>;

  type WireReloadReport = Static<typeof wireSchemas.WireReloadReportSchema>;

  type Frame = Static<typeof wireSchemas.FrameSchema>;
}

export type { wireTypes as default };
