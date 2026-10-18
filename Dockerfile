# syntax=docker/dockerfile:1

# The build stages run on the builder's own platform (BUILDPLATFORM), and Go cross-compiles
# for TARGETPLATFORM, so a multi-arch build needs no emulation.

# 1. Build the web app. Its output is the same on every platform.
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /src
# corepack runs the pnpm version pinned by packageManager in the root package.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/web/ apps/web/
RUN pnpm --filter ./apps/web build

# 2. Build a static Go binary for the target platform with the web app embedded.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/server/ apps/server/
COPY apps/web/embed.go apps/web/
# apps/web/embed.go embeds this build.
COPY --from=web /src/apps/web/dist apps/web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/roster-mate ./apps/server/cmd/roster-mate \
 && mkdir /out/data

# 3. Run it. distroless/static carries CA certificates (for the Anthropic API); the binary
# embeds its own zoneinfo for TZ. It runs as the unprivileged UID/GID 65532, numeric so that
# Kubernetes' runAsNonRoot can check it. /data is owned by 65532, so a fresh Docker volume is
# writable; a bind mount, or a PVC with another runAsUser, must be writable by the running UID.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/roster-mate /roster-mate
COPY --from=server --chown=65532:65532 /out/data /data
USER 65532:65532
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/roster-mate"]
