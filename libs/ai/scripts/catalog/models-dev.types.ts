import type { Api, Model } from "../../src/types.ts";
import type modelsDevReasoningOptionsTypes from "../models-dev-reasoning-options.types.ts";

declare namespace modelsDevTypes {
  interface ModelsDevModel {
    id: string;
    name: string;
    tool_call?: boolean;
    structured_output?: boolean;
    reasoning?: boolean;
    reasoning_options?: modelsDevReasoningOptionsTypes.ModelsDevReasoningOption[];
    status?: string;
    limit?: {
      context?: number;
      output?: number;
    };
    cost?: {
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tiers?: {
        input?: number;
        output?: number;
        cache_read?: number;
        cache_write?: number;
        tier?: {
          type?: string;
          size?: number;
        };
      }[];
    };
    modalities?: {
      input?: string[];
      output?: string[];
    };
    provider?: {
      npm?: string;
    };
  }

  interface ModelsDevProvider {
    models?: Record<string, ModelsDevModel>;
  }

  type ModelsDevCatalog = Record<string, ModelsDevProvider>;

  type ThinkingLevelMap = NonNullable<Model<any>["thinkingLevelMap"]>;

  type ReasoningOptionsRegistry = Map<
    string,
    modelsDevReasoningOptionsTypes.ModelsDevReasoningOption[]
  >;

  interface ModelsDevSource {
    readonly data: ModelsDevCatalog;
    readonly remember: (provider: string, id: string, source: ModelsDevModel) => void;
  }

  interface ModelsDevEntry {
    readonly id: string;
    readonly source: ModelsDevModel;
  }

  interface ModelsDevModelSpec extends ModelsDevEntry {
    readonly api: Api;
    readonly provider: string;
    readonly baseUrl: string;
    readonly compat?: Model<Api>["compat"];
    readonly thinkingLevelMap?: ThinkingLevelMap | undefined;
    readonly overrides?: Partial<Pick<Model<Api>, "input" | "cost" | "reasoning" | "headers">>;
  }
}

export type { modelsDevTypes as default };
