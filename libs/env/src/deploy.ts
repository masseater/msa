import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { dual } from "effect/Function";

import { type DetectFailure, normalizeArch, type RemotePlatform, SetupError } from "./detect.ts";
import { fileExists, localPath, readBytes, sha256Hex } from "./platform.ts";
import { powershell, runSsh } from "./run-ssh.ts";
import type { SshTarget } from "./ssh-args.ts";

const UPLOAD_TIMEOUT_MS = 300_000;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export function packagedDaemon(remote: Pick<RemotePlatform, "platform" | "arch">): string {
  const name = `msa-env-${remote.platform}-${remote.arch}`;
  return localPath.join(
    packageRoot,
    "bin",
    name,
    remote.platform === "windows" ? "msa-env.exe" : "msa-env",
  );
}

export function localDaemon(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  if (
    platform !== "linux" &&
    platform !== "android" &&
    platform !== "darwin" &&
    platform !== "windows"
  ) {
    throw new Error(`No msa-env daemon for ${process.platform}`);
  }
  return packagedDaemon({ platform, arch: normalizeArch(process.arch) });
}

export function quotePosix(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function quotePowerShell(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function daemonPath(remote: RemotePlatform, sha256: string): string {
  const name = `msa-env-${sha256.slice(0, 32)}`;
  return remote.platform === "windows"
    ? `${remote.home}\\.msa\\mobile\\tools\\${name}.exe`
    : `${remote.home}/.msa/mobile/tools/${name}`;
}

const POSIX_HASH = `hash() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | sed 's/.*= //'; else echo none; fi; }`;

interface Deployment {
  readonly target: SshTarget;
  readonly remote: RemotePlatform;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

const checkDaemon = ({
  target,
  remote,
  file,
  sha256,
}: Deployment): Effect.Effect<string, DetectFailure> => {
  if (remote.platform === "windows") {
    const check = powershell(
      `$f = ${quotePowerShell(file)}; if ((Test-Path -LiteralPath $f) -and ((Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower() -eq '${sha256}')) { 'present' } else { 'missing' }`,
    );
    return runSsh({ target, command: check }).pipe(
      Effect.map((output) => (output.trim().endsWith("present") ? "present" : "missing")),
    );
  }
  const check = `${POSIX_HASH}; f=${quotePosix(file)}; if [ -f "$f" ] && [ "$(hash "$f")" = ${sha256} ]; then echo present; elif [ "$(hash /dev/null)" = none ]; then echo nohash; else echo missing; fi`;
  return runSsh({ target, command: `sh -c ${quotePosix(check)}` }).pipe(
    Effect.map((output) => output.trim().split("\n").at(-1) ?? "missing"),
  );
};

const windowsUpload = ({ file, sha256 }: Deployment): string =>
  powershell(
    [
      "$ErrorActionPreference = 'Stop'",
      `$f = ${quotePowerShell(file)}`,
      "$d = Split-Path -Parent $f",
      "New-Item -ItemType Directory -Force -Path $d | Out-Null",
      "$t = Join-Path $d ('.msa-env-' + [guid]::NewGuid().ToString() + '.tmp')",
      "$text = New-Object System.Text.StringBuilder",
      "foreach ($line in $input) { if ($line -eq 'MSA-ENV-END') { break }; [void]$text.Append($line) }",
      "$bytes = [Convert]::FromBase64String($text.ToString())",
      "$out = [IO.File]::Open($t, 'CreateNew', 'Write', 'None'); $out.Write($bytes, 0, $bytes.Length); $out.Close()",
      `if ((Get-FileHash -Algorithm SHA256 -LiteralPath $t).Hash.ToLower() -ne '${sha256}') { Remove-Item -LiteralPath $t; throw 'msa-env upload is corrupt' }`,
      "for ($i = 0; ; $i++) { try { Move-Item -Force -LiteralPath $t -Destination $f; break } catch { if ($i -ge 20) { throw }; Start-Sleep -Milliseconds 250 } }",
      "Get-ChildItem -LiteralPath $d -Filter 'msa-env-*.exe' | Where-Object { $_.FullName -ne $f } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -ErrorAction SilentlyContinue }",
      "'deployed'",
    ].join("; "),
  );

const posixUpload = ({ file, sha256 }: Deployment): string =>
  [
    "set -e",
    POSIX_HASH,
    `f=${quotePosix(file)}`,
    'd=$(dirname "$f")',
    'mkdir -p "$d"',
    'chmod 700 "$d"',
    't=$(mktemp "$d/.msa-env.XXXXXX")',
    'cat > "$t"',
    `if [ "$(hash "$t")" != ${sha256} ]; then rm -f "$t"; echo "msa-env upload is corrupt" >&2; exit 1; fi`,
    'chmod 700 "$t"',
    'mv -f "$t" "$f"',
    'for old in "$d"/msa-env-*; do [ "$old" = "$f" ] || rm -f "$old"; done',
    "echo deployed",
  ].join("\n");

const upload = (deployment: Deployment): Effect.Effect<string, DetectFailure> => {
  const { target, remote, file, bytes } = deployment;
  if (remote.platform === "windows") {
    const lines = Buffer.from(bytes)
      .toString("base64")
      .replaceAll(/.{1,76}/gu, "$&\n");
    return runSsh({
      target,
      command: windowsUpload(deployment),
      stdin: Buffer.from(`${lines}MSA-ENV-END\n`),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }).pipe(Effect.as(file));
  }
  return runSsh({
    target,
    command: `sh -c ${quotePosix(posixUpload(deployment))}`,
    stdin: bytes,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  }).pipe(Effect.as(file));
};

export interface DaemonDeployment {
  readonly target: SshTarget;
  readonly remote: RemotePlatform;
  readonly binary: string;
}

export const deployDaemonEffect = ({
  target,
  remote,
  binary,
}: DaemonDeployment): Effect.Effect<string, DetectFailure> =>
  Effect.gen(function* () {
    if (!(yield* fileExists(binary))) {
      return yield* new SetupError(
        `No msa-env daemon for ${remote.platform}-${remote.arch} at ${binary}`,
      );
    }
    const bytes = yield* readBytes(binary);
    const sha256 = yield* sha256Hex(bytes);
    const deployment: Deployment = {
      target,
      remote,
      file: daemonPath(remote, sha256),
      sha256,
      bytes,
    };
    const state = yield* checkDaemon(deployment);
    if (state === "present") return deployment.file;
    if (state === "nohash") {
      return yield* new SetupError(
        `${target.host} has no sha256sum, shasum or openssl to verify msa-env`,
      );
    }
    return yield* upload(deployment);
  });

export const deployDaemon: {
  (remote: RemotePlatform, binary: string): (target: SshTarget) => Promise<string>;
  (target: SshTarget, remote: RemotePlatform, binary: string): Promise<string>;
} = dual(3, (target: SshTarget, remote: RemotePlatform, binary: string): Promise<string> =>
  Effect.runPromise(deployDaemonEffect({ target, remote, binary })),
);
