FROM node:24.21.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@12.11.2 --activate

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY web web
COPY contracts contracts
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-only-auth-secret-0000000000000000 \
    SERVICE_TOKEN_SECRET=build-only-service-secret-000000000000 \
    PRICING_DIAGNOSTIC_SECRET=build-only-pricing-secret-000000000000 \
    pnpm --filter @onholidai/web build

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=build /workspace /workspace

# pnpm's launcher fetches its platform binary on first use. Warm that cache while
# the build still has registry access so production containers start offline.
RUN pnpm --version

EXPOSE 3000

CMD ["pnpm", "--filter", "@onholidai/web", "start"]
