FROM node:24.21.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile --filter @onholidai/web...

FROM dependencies AS build

COPY web web
RUN pnpm --filter @onholidai/web build

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=build /workspace /workspace

EXPOSE 3000

CMD ["pnpm", "--filter", "@onholidai/web", "start"]