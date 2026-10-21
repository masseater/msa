import type trustManagerTypes from "../../../core/trust-manager.types.ts";
import type TrustSelectorComponentClass from "./trust-selector.ts";

declare namespace trustSelectorTypes {
  type TrustSelection = Pick<trustManagerTypes.ProjectTrustOption, "trusted" | "updates">;

  interface TrustSelectorOptions {
    cwd: string;
    savedDecision: trustManagerTypes.ProjectTrustStoreEntry | null;
    trustOptions: trustManagerTypes.ProjectTrustOption[];
    projectTrusted: boolean;
    onSelect: (selection: TrustSelection) => void;
    onCancel: () => void;
  }

  type TrustSelectorComponent = (typeof TrustSelectorComponentClass)["prototype"];
}

export type { trustSelectorTypes as default };
