# Run msa in an isolated environment

Use an isolated environment to limit the files, credentials, processes, and network services that generated commands can access or affect.

You can isolate the complete msa process or keep msa on the host and route selected tools into an isolated environment.

## Choose an isolation method

| Method             | Where msa runs          | What is isolated                                  | Credential handling                                                                        | Best for                                                               |
| ------------------ | ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Plain Docker       | Container               | msa, built-in tools, `!` commands, and extensions | Credentials passed into the container                                                      | A straightforward local container boundary                             |
| Docker Sandboxes   | Managed sandbox         | msa, built-in tools, `!` commands, and extensions | Provider credentials remain on the host and are substituted by the proxy                   | Managed local isolation without exposing the real provider key         |
| OpenShell          | Local or remote sandbox | msa, built-in tools, `!` commands, and extensions | Policy-controlled credentials and inference routing                                        | Filesystem, process, network, and credential policies                  |
| Gondolin extension | Host                    | Built-in tools and `!` commands                   | Stored msa credentials remain on the host, but commands inherit host environment variables | A local micro-VM for tool execution while retaining the host interface |

The method changes where extensions run. When the complete msa process runs inside an isolated environment, its extensions run there too. When host msa delegates built-in tools through Gondolin, other extension tools still run on the host unless they also delegate their work.

## Decide what msa can access

An isolated process can still affect resources you expose to it:

- A read-write host mount lets msa modify those host files.
- Mounting `~/.msa/agent` exposes your msa credentials, settings, extensions, and sessions.
- Environment variables passed into a container are available to processes inside it.
- Network access may allow code or tool output to leave the environment.
- Tool-only isolation does not constrain the host msa process or extension tools that do not use the isolated backend.

Expose only the working folder, credentials, and network destinations needed for the task. Use read-only mounts or copy files into and out of the environment when you do not want writes to affect the host.

## Run msa in plain Docker

Plain Docker provides the simplest whole-process container boundary.

### Build the image

Create `Dockerfile.msa`:

```dockerfile
FROM node:24-bookworm-slim
ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN arch="$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64)" \
  && curl -fsSL "https://github.com/masseater/msa/releases/latest/download/msa-linux-${arch}.tar.gz" \
  | tar -xz -C /opt \
  && ln -s /opt/msa/msa /usr/local/bin/msa

WORKDIR /workspace
ENTRYPOINT ["msa"]
```

Build it from the directory containing the file:

```bash
docker build -t msa-sandbox -f Dockerfile.msa .
```

### Start msa

From the working folder you want msa to access, run:

```bash
docker run --rm -it \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v msa-agent-home:/root/.msa/agent \
  msa-sandbox
```

Replace `ANTHROPIC_API_KEY` with the credential required by your provider. The named `msa-agent-home` volume keeps container-local settings, credentials, and sessions between runs.

Do not mount the host's `~/.msa/agent` unless the container should have access to your host msa configuration and credentials.

### Verify the workspace

Inside msa, run:

```text
!pwd
```

The command should report `/workspace`. Changes under `/workspace` write through to the mounted host folder. Remove the bind mount or use a read-only mount when that is not acceptable.

## Run msa with Docker Sandboxes

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) runs the complete msa process inside a managed sandbox. Its proxy can keep the real provider credential on the host and substitute it when requests leave the sandbox.

Configure credentials before creating the sandbox. Do not run `/login` inside the sandbox because that writes a real credential into it.

### Use an Anthropic API key

```bash
sbx secret set anthropic
```

A Claude Pro or Max subscription is used through [`claude-subs`](cli-agents.md) instead.

### Start msa

Run this from the working folder you want mounted:

```bash
sbx run --kit "docker.io/sbx/msa-kit:latest" msa
```

For an existing sandbox, run msa non-interactively with:

```bash
sbx exec <sandbox-name> -- msa -p "list the failing tests"
```

See the [msa kit documentation](https://github.com/docker/sbx-kits-contrib/tree/main/msa) for other providers, troubleshooting, and image pinning.

## Run msa with OpenShell

[NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) provides local or remote sandboxes with filesystem, process, network, credential, and inference policies.

### Select a gateway

Every sandbox requires an active gateway:

```bash
openshell gateway add <gateway-url> --name <name>
openshell gateway select <name>
```

### Create the sandbox

```bash
openshell sandbox create --name msa-sandbox --from msa -- msa
```

msa, its built-in tools, `!` commands, and extension tools run inside the OpenShell boundary.

### Transfer files to a remote sandbox

A remote gateway does not bind-mount your host working folder. Clone the repository inside the sandbox or transfer files explicitly:

```bash
openshell sandbox upload msa-sandbox ./working-folder /workspace
openshell sandbox download msa-sandbox /workspace/working-folder ./working-folder-out
```

OpenShell inference routing can keep raw model credentials outside the sandbox. When configured, point msa at the corresponding OpenAI-compatible or Anthropic-compatible endpoint exposed by the gateway.

## Route tools through Gondolin

[Gondolin](https://github.com/earendil-works/gondolin) is a local Linux micro-VM. Its example extension keeps the msa process and file-based provider credentials on the host while routing the built-in tools and user `!` commands into the VM.

Commands inside the VM inherit the host process environment. Provider keys supplied through environment variables can therefore be visible inside the VM. Do not use this pattern as a credential boundary unless you remove sensitive variables or change the extension's environment handling.

Gondolin requires Node.js 23.6 or newer and QEMU installed through your operating-system package manager.

### Install the extension

From a msa source checkout:

```bash
mkdir -p ~/.msa/agent/extensions
cp -R apps/coding-agent/examples/extensions/gondolin ~/.msa/agent/extensions/gondolin
cd ~/.msa/agent/extensions/gondolin
npm install --ignore-scripts
```

### Start msa

Run msa from the working folder you want mounted:

```bash
cd /path/to/working-folder
msa -e ~/.msa/agent/extensions/gondolin
```

The extension mounts the host working folder at `/workspace` in the VM and overrides `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. File changes under `/workspace` write through to the host.

Other extension tools still run on the host unless they explicitly delegate their operations. Review the [Gondolin example](../examples/extensions/gondolin/) before adding tools that could bypass the VM boundary.
