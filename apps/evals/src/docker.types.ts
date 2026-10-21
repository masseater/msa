import type planTypes from "./plan.types.ts";

declare namespace dockerTypes {
  type BuiltImages = Record<planTypes.DocumentationVariant, { name: string; id: string }>;

  type DockerContext = {
    images: BuiltImages;
    artifactDirectory: string;
    authPath: string;
    provider: string;
    model: string;
    runsPerVariant: number;
  };
}

export type { dockerTypes as default };
