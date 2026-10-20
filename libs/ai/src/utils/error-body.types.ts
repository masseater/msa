declare namespace errorBodyTypes {
  interface NormalizedProviderError {
    status?: number | undefined;
    body?: string | undefined;
    message: string;
    messageCarriesBody: boolean;
  }
}

export type { errorBodyTypes as default };
