declare namespace hydrateModelCatalogTypes {
  interface HydrateModelCatalogRequest {
    readonly packageRoot: string;
    readonly catalogPath: string;
    readonly validateOnly?: boolean | undefined;
  }
}

export type { hydrateModelCatalogTypes as default };
