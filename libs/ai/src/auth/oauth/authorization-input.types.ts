declare namespace authorizationInputTypes {
  interface AuthorizationInput {
    readonly code?: string | undefined;
    readonly state?: string | undefined;
  }
}

export type { authorizationInputTypes as default };
