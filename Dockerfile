# Employee Client Dockerfile
FROM node:18-alpine AS builder

# Install build dependencies for native modules and Electron
RUN apk add --no-cache python3 make g++ libx11-dev libxkbfile-dev libsecret-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Runtime stage (for headless operation)
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache dumb-init xvfb libxrandr libxinerama libxcursor libxi libxtst

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S client -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build

# Create data and logs directories
RUN mkdir -p data logs && chown -R client:nodejs data logs

# Change ownership of the app directory
RUN chown -R client:nodejs /app

# Switch to non-root user
USER client

# Set environment for headless operation
ENV DISPLAY=:99

# Expose monitoring port (if needed)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "electron" > /dev/null || exit 1

# Start the application with virtual display
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 & exec npm start"]