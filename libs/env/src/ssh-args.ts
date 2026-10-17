import { dual } from "effect/Function";

export interface SshTarget {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  knownHostsFile: string;
  hostKeyAlias: string;
  ssh?: string;
  configFile?: string;
}

export interface SshArgumentOptions {
  readonly strictHostKeys: boolean;
  readonly knownHostsFile: string;
}

const WHITESPACE = /\s/u;

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
}

function checkField(name: string, value: string): void {
  if (
    value === "" ||
    value.startsWith("-") ||
    [...value].some((character) => isControl(character) || WHITESPACE.test(character))
  ) {
    throw new Error(`Invalid ${name}: ${JSON.stringify(value)}`);
  }
}

function configPath(name: string, path: string): string {
  if (path === "" || [...path].some((character) => character === '"' || isControl(character))) {
    throw new Error(`Invalid ${name}: ${JSON.stringify(path)}`);
  }
  return `"${path.replaceAll("%", "%%")}"`;
}

function checkTarget(target: SshTarget): void {
  checkField("host", target.host);
  checkField("host key alias", target.hostKeyAlias);
  if (target.user !== undefined) checkField("user", target.user);
  if (
    target.port !== undefined &&
    (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)
  ) {
    throw new Error(`Invalid port: ${target.port}`);
  }
}

const option = (setting: string): string[] => ["-o", setting];

export const sshArgumentsWith: {
  (options: SshArgumentOptions): (target: SshTarget) => string[];
  (target: SshTarget, options: SshArgumentOptions): string[];
} = dual(2, (target: SshTarget, options: SshArgumentOptions): string[] => {
  checkTarget(target);
  return [
    ...(target.configFile === undefined ? [] : ["-F", target.configFile]),
    "-T",
    "-a",
    "-x",
    ...option("BatchMode=yes"),
    ...option("ClearAllForwardings=yes"),
    ...option("ForwardAgent=no"),
    ...option("ForwardX11=no"),
    ...option("ControlMaster=no"),
    ...option("ControlPath=none"),
    ...option("RemoteCommand=none"),
    ...option("PermitLocalCommand=no"),
    ...option("SendEnv=-*"),
    ...option("ServerAliveInterval=15"),
    ...option(`StrictHostKeyChecking=${options.strictHostKeys ? "yes" : "accept-new"}`),
    ...option(`UserKnownHostsFile=${configPath("known hosts file", options.knownHostsFile)}`),
    ...option("GlobalKnownHostsFile=none"),
    ...option("HashKnownHosts=no"),
    ...option(`HostKeyAlias=${target.hostKeyAlias}`),
    ...(target.user === undefined ? [] : ["-l", target.user]),
    ...(target.port === undefined ? [] : ["-p", String(target.port)]),
    ...(target.identityFile === undefined
      ? []
      : [
          ...option(`IdentityFile=${configPath("identity file", target.identityFile)}`),
          ...option("IdentitiesOnly=yes"),
        ]),
    "--",
    target.host,
  ];
});

export function sshArguments(target: SshTarget): string[] {
  return sshArgumentsWith(target, {
    strictHostKeys: true,
    knownHostsFile: target.knownHostsFile,
  });
}
