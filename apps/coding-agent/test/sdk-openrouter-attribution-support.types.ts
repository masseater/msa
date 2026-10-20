declare namespace sdkOpenrouterAttributionSupportTypes {
  interface CaptureOptions {
    telemetryEnabled?: boolean;
    providerHeaders?: Record<string, string>;
    requestHeaders?: Record<string, string>;
    sessionId?: string;
  }
}

export type { sdkOpenrouterAttributionSupportTypes as default };
