import type extensionsTypesTypes from "./extensions/types.types.ts";

declare namespace externalServicesTypes {
  interface ServiceSignInPage {
    url: string;
    code?: string;
  }

  type ServiceStatus =
    | { installed: false; install: string }
    | { installed: true; signedIn: boolean };

  interface ServiceLogoutInteraction {
    select(title: string, options: string[]): Promise<string>;
  }

  interface ServiceLoginInteraction extends ServiceLogoutInteraction {
    showPage(page: ServiceSignInPage): void;
    prompt(message: string, placeholder?: string): Promise<string>;
  }

  interface ExternalService {
    id: string;
    name: string;
    purpose: string;
    status(): Promise<ServiceStatus>;
    login(interaction: ServiceLoginInteraction, signal: AbortSignal): Promise<void>;
    logout(interaction: ServiceLogoutInteraction): Promise<void>;
    tools?(): extensionsTypesTypes.ToolDefinition[];
  }
}

export type { externalServicesTypes as default };
