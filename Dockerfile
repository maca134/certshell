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

# Built from source: the v0.21.2 release binary has Go 1.27.1 / x/net 0.59.0 CVEs. Module versions are
# checked against Go's checksum database. Bump SHOUTRRR/X_NET by hand; Dependabot bumps the Go image.
FROM --platform=$BUILDPLATFORM golang:1.27.2-trixie@sha256:e58d6f83b3416618d8bcac2b3dde1b7f7e3c4a77d25e88637f8bbae81536c48d AS shoutrrr
ARG TARGETOS TARGETARCH
ARG SHOUTRRR=v0.21.2 X_NET=v0.61.0
WORKDIR /build
RUN go mod init build && \
    go get github.com/nicholas-fedor/shoutrrr/shoutrrr@$SHOUTRRR golang.org/x/net@$X_NET && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOTOOLCHAIN=local \
    go build -trimpath -ldflags "-s -w" -o /shoutrrr github.com/nicholas-fedor/shoutrrr/shoutrrr

FROM oven/bun:1-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && \
    rm -rf /var/lib/apt/lists/* && install -d -o 1000 -g 1000 /data
WORKDIR /app
COPY --from=api /app ./
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
# Sends alerts (SPEC §3.5).
COPY --from=shoutrrr /shoutrrr /usr/local/bin/shoutrrr
ARG VERSION=dev
ENV CERTSHELL_VERSION=$VERSION
USER 1000:1000
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["bun", "run", "apps/api/src/main.ts"]
