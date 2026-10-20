import type aiTypes from "@msa/ai/index.types";

declare namespace modelUpgradeTypes {
  interface ModelIdVersion {
    family: string;

    version: number[];

    variant: string;

    date: string | undefined;
  }

  interface ModelUpgradeCandidate {
    from: aiTypes.Model<aiTypes.Api>;
    to: aiTypes.Model<aiTypes.Api>;

    confident: boolean;

    reason: string;
  }

  interface ModelReferenceChange {
    setting: string;
    from: string;
    to: string;
  }

  interface ModelUpgradePlan {
    candidates: ModelUpgradeCandidate[];
    changes: Array<ModelReferenceChange & { scope: "global" | "project" }>;

    unreachable: string[];
  }
}

export type { modelUpgradeTypes as default };
