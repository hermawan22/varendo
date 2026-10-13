ARG SOURCE_REVISION=unknown
ARG SDK_SOURCE_REVISION=unknown
ARG SDK_VERSION=unknown

FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS site-build

ARG VARENDO_EXPORT_VERIFIED_VERSION=
ENV VARENDO_EXPORT_VERIFIED_VERSION=${VARENDO_EXPORT_VERIFIED_VERSION}

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json release-metadata.json ./
COPY packages ./packages
COPY apps ./apps
COPY catalog ./catalog
COPY docs/public-site ./docs/public-site
COPY docs/site ./docs/site
COPY examples ./examples
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile \
  && pnpm --dir apps/site build \
  && test -f /workspace/apps/site/dist/index.html \
  && test -f /workspace/apps/site/dist/404.html \
  && test -f /workspace/apps/site/dist/docs/components/data.table/index.html

FROM golang:1.27.2-alpine@sha256:85dc1069ac644ea3c527b177303a406eb3358192816cd7f9e5848eb658851673 AS server-build

ARG SOURCE_REVISION
ARG SDK_SOURCE_REVISION
ARG SDK_VERSION
WORKDIR /src
COPY apps/site/deploy/server.go ./server.go

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
  -ldflags="-s -w -X main.revision=${SOURCE_REVISION} -X main.sdkRevision=${SDK_SOURCE_REVISION} -X main.sdkVersion=${SDK_VERSION}" \
  -o /varendo-static-server ./server.go

FROM scratch

ARG SOURCE_REVISION
ARG SDK_SOURCE_REVISION
ARG SDK_VERSION
LABEL org.opencontainers.image.source="https://github.com/hermawan22/varendo"
LABEL org.opencontainers.image.description="Varendo public web, documentation, and playground"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
LABEL com.varendo.sdk.revision="${SDK_SOURCE_REVISION}"
LABEL com.varendo.sdk.version="${SDK_VERSION}"

COPY --from=server-build /varendo-static-server /varendo-static-server
COPY --from=site-build /workspace/apps/site/dist /srv/varendo

WORKDIR /srv/varendo
USER 101:101
EXPOSE 8080
ENTRYPOINT ["/varendo-static-server"]
