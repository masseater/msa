import type LlamaClientClass from "./llama-client.ts";

declare namespace clientTypes {
  type LlamaModelStatus = "unloaded" | "loading" | "loaded" | "downloading" | "sleeping";

  interface LlamaModelInfo {
    id: string;
    aliases?: string[];
    status: {
      value: LlamaModelStatus;
      args?: string[];
      failed?: boolean;
      exit_code?: number;
      progress?: Record<string, { done: number; total: number }>;
    };
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
    source?: string;
    meta?: {
      n_ctx?: number;
      n_ctx_train?: number;
      size?: number;
      ftype?: string;
    };
  }

  interface LlamaModelsResponse {
    data: LlamaModelInfo[];
    object?: string;
  }

  interface LlamaServerProps {
    models_autoload?: boolean;
    chat_template?: string;
  }

  interface LlamaModelEvent {
    model: string;
    event: string;
    data?: unknown;
  }

  interface LlamaProgress {
    message: string;
    ratio?: number | undefined;
    detail?: string | undefined;
  }

  type LlamaClient = (typeof LlamaClientClass)["prototype"];
}

export type { clientTypes as default };
