FROM node:24-slim AS builder
WORKDIR /work
RUN npm install -g pnpm@12.10.1 vite-plus@1.1.0
# Build against an ephemeral copy of the repository. Only outputs staged under
# /opt/evaluator persist; node_modules and dist created in /repo are discarded.
# The copy is required because the build-context mount and its writable upper
# are different devices, so renaming a directory out of the mount fails EXDEV.
RUN --mount=type=bind,source=.,target=/src \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/vite-plus \
    cp -a /src /repo \
    && cd /repo \
    && vp install --frozen-lockfile --ignore-scripts \
    && vp run hydrate:model-data \
    && vp run --filter @msa/telemetry build \
    && vp run build:offline \
    && node apps/evals/docker/install-runtime.mjs /opt/evaluator

# Both variants use the same installed runtime. The control removes only the
# coding-agent documentation whose effect the experiment measures.
FROM builder AS without-docs-install
RUN rm -rf \
    /opt/evaluator/install/node_modules/@msa/coding-agent/README.md \
    /opt/evaluator/install/node_modules/@msa/coding-agent/CHANGELOG.md \
    /opt/evaluator/install/node_modules/@msa/coding-agent/docs \
    /opt/evaluator/install/node_modules/@msa/coding-agent/examples

FROM node:24-slim AS evaluator
COPY --from=builder /opt/evaluator/root /repo
WORKDIR /repo/apps/evals
# Vitest starts as root so it can load evaluator code. Before prompting the
# model, the harness permanently drops to UID 65532. Keep evaluator sources
# root-only so model tools and generated code cannot inspect judges or fixtures.
RUN chmod -R go-rwx \
      /repo/apps/evals/src \
      /repo/apps/evals/evals \
      /repo/apps/evals/docker \
    && chmod go-rwx \
      /repo/apps/evals/vitest.container.config.ts \
    && mkdir -p /run/msa-eval-secrets \
    && chmod 0700 /run/msa-eval-secrets
ENTRYPOINT ["node", "--experimental-strip-types", "docker/entrypoint.ts"]

FROM evaluator AS without_docs
COPY --from=without-docs-install /opt/evaluator/install/node_modules /repo/node_modules
ENV MSA_EVAL_VARIANT=without_docs

FROM evaluator AS with_docs
COPY --from=builder /opt/evaluator/install/node_modules /repo/node_modules
ENV MSA_EVAL_VARIANT=with_docs
