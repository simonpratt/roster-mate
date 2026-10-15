# syntax=docker/dockerfile:1

# 1. Build the web app.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. Build a static Go binary with the web app embedded.
FROM golang:1.26-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /web/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/roster-mate ./cmd/roster-mate

# 3. Run it. distroless/static carries CA certificates (for the Anthropic API); the binary
# embeds its own zoneinfo for TZ. It runs as root so a bind-mounted /data that Docker created
# on the host is writable.
FROM gcr.io/distroless/static-debian12
COPY --from=server /out/roster-mate /roster-mate
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/roster-mate"]
