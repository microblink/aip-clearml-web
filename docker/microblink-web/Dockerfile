# Multi-stage build: compile Angular app + widgets, then overlay onto ClearML server.
# Requires podman or docker on the host — see ./build.sh

ARG CLEARML_SERVER_IMAGE=docker.io/clearml/server:2.4.0

FROM node:24-bookworm AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm run build && pnpm run build-widgets

FROM ${CLEARML_SERVER_IMAGE}

# Stock server image ships its own static UI; remove it so COPY does not fail when
# a path is a file in the new build but a directory in the base image (widgets assets).
RUN rm -rf /usr/share/nginx/html /usr/share/nginx/widgets

COPY --from=builder /app/build/browser/ /usr/share/nginx/html/
COPY --from=builder /app/dist/report-widgets/browser/ /usr/share/nginx/widgets/
