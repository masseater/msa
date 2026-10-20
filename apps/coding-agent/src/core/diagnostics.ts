declare namespace diagnosticsTypes {
  interface ResourceCollision {
    resourceType: "extension" | "skill" | "prompt" | "theme";
    name: string;
    winnerPath: string;
    loserPath: string;
    winnerSource?: string;
    loserSource?: string;
  }

  interface ResourceDiagnostic {
    type: "warning" | "error" | "collision";
    message: string;
    path?: string | undefined;
    collision?: ResourceCollision | undefined;
  }
}

export type { diagnosticsTypes as default };
