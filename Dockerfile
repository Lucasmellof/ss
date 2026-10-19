FROM --platform=$BUILDPLATFORM oven/bun:1 AS web

WORKDIR /src/desktop
COPY desktop/package.json desktop/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY desktop/ ./
RUN bun run build:web

FROM golang:1.23-alpine AS build

WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/screen-share ./cmd/ss

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/screen-share /screen-share
EXPOSE 8080/tcp
ENTRYPOINT ["/screen-share"]
