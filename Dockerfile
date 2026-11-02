FROM golang:1.23-alpine AS build

WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/screen-share ./cmd/ss

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/screen-share /screen-share
USER 65532:65532
EXPOSE 8080/tcp 40000/udp
ENTRYPOINT ["/screen-share"]
