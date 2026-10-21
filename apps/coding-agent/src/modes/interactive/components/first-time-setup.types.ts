import type FirstTimeSetupComponentClass from "./first-time-setup.ts";

declare namespace firstTimeSetupTypes {
  interface FirstTimeSetupResult {
    theme: string;
    shareAnalytics: boolean;
  }

  interface FirstTimeSetupOptions {
    onThemePreview: (themeName: string) => void;
    onSubmit: (result: FirstTimeSetupResult) => void;
    onCancel: () => void;
  }

  type FirstTimeSetupComponent = (typeof FirstTimeSetupComponentClass)["prototype"];
}

export type { firstTimeSetupTypes as default };
