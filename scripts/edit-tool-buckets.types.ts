declare namespace editToolBucketsTypes {
  interface Outcome {
    readonly resolved: number;
    readonly success: number;
    readonly failed: number;
  }

  interface ModeStats extends Outcome {
    readonly mode: string;
    readonly calls: number;
    readonly unresolved: number;
    readonly successRate: number | null;
    readonly failureRate: number | null;
  }

  interface LengthBucket extends Outcome {
    readonly key: string;
    readonly label: string;
    readonly calls: number;
    readonly unresolved: number;
    readonly successRate: number | null;
    readonly failureRate: number | null;
  }

  interface InflationBucket {
    readonly key: string;
    readonly label: string;
    readonly count: number;
    readonly resolved: number;
    readonly failed: number;
    readonly failureRate: number | null;
  }

  interface ClusterStats {
    readonly clustersCount: number;
    readonly assistantMessagesWithCluster: number;
    readonly assistantMessagesWithMultiEdit: number;
    readonly callsInsideClusters: number;
    readonly averageCallsPerCluster: number | null;
    readonly ratioClusterAssistantMessagesToMultiEditAssistantMessages: number | null;
  }

  interface WorstExample {
    readonly providerModel: string;
    readonly extension: string;
    readonly path: string;
    readonly inflationRatio: number | null;
    readonly totalEditBytes: number;
    readonly coreBytes: number;
    readonly mode: string;
    readonly editsCount: number;
    readonly failed: boolean;
    readonly errorKind: string | null;
    readonly sessionFile: string;
  }

  interface Threshold {
    readonly threshold: number;
    readonly count: number;
  }
}

export type { editToolBucketsTypes as default };
