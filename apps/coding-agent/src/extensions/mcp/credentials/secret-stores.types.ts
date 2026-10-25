declare namespace secretStoresTypes {
  interface SecretStore {
    readonly description: string;
    readonly persistent: boolean;
    read(): Promise<string | undefined>;
    write(value: string): Promise<void>;
  }

  interface CredentialHelperConfig {
    readonly command: string;
    readonly args?: readonly string[] | undefined;
  }
}

export type { secretStoresTypes as default };
