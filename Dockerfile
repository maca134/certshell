FROM oven/bun:1-debian AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --filter web
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run --filter web build

FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && \
    rm -rf /var/lib/apt/lists/* && install -d -o 1000 -g 1000 /data
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter api
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
USER 1000:1000
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["bun", "run", "apps/api/src/main.ts"]
