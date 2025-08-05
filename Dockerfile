# ordr.fm Dockerfile - Complete Music Organization System
# Combines Bash processing engine with Node.js web interface

# Multi-stage build for optimized image size
FROM node:18-alpine AS node-builder

# Install Node.js dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Build stage with all system dependencies
FROM alpine:3.18 AS system-deps

# Install system dependencies
RUN apk add --no-cache \
    bash \
    sqlite \
    curl \
    jq \
    bc \
    rsync \
    perl-image-exiftool \
    nodejs \
    npm \
    tzdata \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S ordr && \
    adduser -S ordr -u 1001 -G ordr

# Final stage
FROM system-deps AS final

# Set up application directory
WORKDIR /app
RUN chown -R ordr:ordr /app

# Copy Bash scripts and configuration
COPY --chown=ordr:ordr . /app/

# Copy Node.js application and dependencies
COPY --from=node-builder --chown=ordr:ordr /app/server/node_modules /app/server/node_modules

# Create directories for data and configuration
RUN mkdir -p /app/data/music /app/data/organized /app/data/unsorted /app/config /app/logs /app/cache && \
    chown -R ordr:ordr /app/data /app/config /app/logs /app/cache

# Set up configuration template
RUN cp ordr.fm.conf.example /app/config/ordr.fm.conf.template

# Make scripts executable
RUN chmod +x /app/*.sh /app/lib/*.sh

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Switch to non-root user
USER ordr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose ports
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV ORDR_CONFIG_FILE=/app/config/ordr.fm.conf

# Default command
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["server"]

# Labels
LABEL org.opencontainers.image.title="ordr.fm"
LABEL org.opencontainers.image.description="The Ultimate Music Organization System"
LABEL org.opencontainers.image.source="https://github.com/adrianwedd/ordr.fm"
LABEL org.opencontainers.image.version="2.1.0"
LABEL org.opencontainers.image.authors="ordr.fm team"
LABEL org.opencontainers.image.licenses="MIT"