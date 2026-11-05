# Multi-stage secure build for Cafeteria Wallet Microservice
FROM node:22-alpine AS production

# Security: Run as dedicated non-privileged user
RUN addgroup -g 1001 cafeteria && \
    adduser -u 1001 -G cafeteria -s /bin/sh -D cafeteria

WORKDIR /app

# Copy application source code
COPY --chown=cafeteria:cafeteria src ./src

# Create data directory for sqlite database with write permissions for non-root user
RUN mkdir -p /app/data && chown -R cafeteria:cafeteria /app

USER cafeteria

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "--experimental-sqlite", "src/server.js"]
