# Bun stages run on the build host; their output is arch-independent, so arm64 only emulates apt-get.
FROM --platform=$BUILDPLATFORM oven/bun:1-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --filter web
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run --filter web build

FROM --platform=$BUILDPLATFORM oven/bun:1-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS api
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter api

FROM oven/bun:1-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && \
    rm -rf /var/lib/apt/lists/* && install -d -o 1000 -g 1000 /data
WORKDIR /app
COPY --from=api /app ./
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
USER 1000:1000
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["bun", "run", "apps/api/src/main.ts"]
