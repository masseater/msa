import type AgentSession from "../agent-session.ts";
import externalServices from "../external-services.ts";
import type externalServicesTypes from "../external-services.types.ts";

const { EXTERNAL_SERVICES } = externalServices;

export default class SessionExternalServiceTools {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  getExternalServices(): externalServicesTypes.ExternalService[] {
    return [
      ...EXTERNAL_SERVICES,
      ...this.session.extensions.binding.extensionRunnerInternal.getExternalServices(),
    ];
  }

  addExternalServiceTools(): string[] {
    const names: string[] = [];
    for (const service of this.getExternalServices()) {
      for (const tool of service.tools?.() ?? []) {
        this.session.tools.registry.addBaseToolDefinition(tool);
        names.push(tool.name);
      }
    }
    return names;
  }

  refreshExternalServiceTools(): void {
    const { loadout, policy, registry } = this.session.tools;
    if (registry.baseToolsOverride !== undefined) return;
    const names = this.addExternalServiceTools();
    const defaultTools = policy.currentDefaultTools();
    registry.refreshToolRegistry({
      activeToolNames: [
        ...loadout.getActiveToolNames(),
        ...names.filter((name) => defaultTools.includes(name)),
      ],
    });
  }
}
