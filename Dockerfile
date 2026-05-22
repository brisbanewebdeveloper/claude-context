# Supply-chain review:
# - Uses the official Node.js 20 Debian slim image.
# - Uses pnpm 10.0.0 through Corepack.
# - Uses the existing lockfile and introduces no new npm dependencies.
# - Dependency lifecycle scripts execute inside the image build container.
FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY . .

RUN pnpm i --frozen-lockfile

RUN pnpm --filter @zilliz/claude-context-core build \
    && pnpm --filter @zilliz/claude-context-mcp build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3000
ENV MCP_HTTP_PATH=/mcp

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY --from=build /app /app

EXPOSE 3000

CMD ["node", "packages/mcp/dist/index.js"]
