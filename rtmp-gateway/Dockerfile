# syntax=docker/dockerfile:1
# Multi-stage build of the RTMP auth gateway. Pure-Go static binary → distroless.
# The app is reached over plain HTTP (intranet), so no CA bundle is needed; if
# APP_BASE is ever switched to https, swap in static-debian12 + ca-certificates.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/rtmp-gateway .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/rtmp-gateway /rtmp-gateway
EXPOSE 1935
ENTRYPOINT ["/rtmp-gateway"]
