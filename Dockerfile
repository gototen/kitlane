# Kitlane control service. Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY examples/tz-minified/package.json examples/tz-minified/
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY tsconfig.base.json ./
COPY packages ./packages
COPY examples ./examples
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    KITLANE_DATA_DIR=/data \
    KITLANE_HOST=0.0.0.0 \
    KITLANE_PORT=3000
WORKDIR /app
RUN addgroup -S kitlane && adduser -S kitlane -G kitlane && mkdir -p /data && chown kitlane:kitlane /data
COPY --from=build --chown=kitlane:kitlane /app/node_modules ./node_modules
COPY --from=build --chown=kitlane:kitlane /app/package.json ./package.json
COPY --from=build --chown=kitlane:kitlane /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=kitlane:kitlane /app/packages/server/dist ./packages/server/dist
COPY --from=build --chown=kitlane:kitlane /app/packages/server/public ./packages/server/public
COPY --from=build --chown=kitlane:kitlane /app/packages/sdk ./packages/sdk
COPY --from=build --chown=kitlane:kitlane /app/examples ./examples
USER kitlane
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["node", "packages/server/dist/bin.js"]
CMD ["serve"]
