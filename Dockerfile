FROM oven/bun:1-debian AS web
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && \
    rm -rf /var/lib/apt/lists/* && install -d -o 1000 -g 1000 /data
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY --from=web /app/dist ./dist
USER 1000:1000
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["bun","run","src/main.ts"]
