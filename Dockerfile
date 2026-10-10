# Bun stages run on the build host; their output is arch-independent, so arm64 only emulates apt-get.
FROM --platform=$BUILDPLATFORM oven/bun:1-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --filter web
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run --filter web build

FROM --platform=$BUILDPLATFORM oven/bun:1-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b AS api
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter api

FROM oven/bun:1-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && \
    rm -rf /var/lib/apt/lists/* && install -d -o 1000 -g 1000 /data
WORKDIR /app
COPY --from=api /app ./
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
ARG VERSION=dev
ENV CERTSHELL_VERSION=$VERSION
USER 1000:1000
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["bun", "run", "apps/api/src/main.ts"]
