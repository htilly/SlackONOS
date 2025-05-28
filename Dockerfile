# syntax=docker/dockerfile:1.4

ARG TARGETPLATFORM

# Stage for Node 24 (default for amd64 and arm64)
FROM --platform=$TARGETPLATFORM node:24.0-slim AS node24

# Stage for Node 23 (fallback for arm/v7)
FROM --platform=$TARGETPLATFORM node:23.0-slim AS node23

# Select base depending on platform
FROM node24 AS base
ARG TARGETPLATFORM
RUN if [ "$TARGETPLATFORM" = "linux/arm/v7" ]; then exit 1; fi

FROM node23 AS base
ARG TARGETPLATFORM
RUN if [ "$TARGETPLATFORM" != "linux/arm/v7" ]; then exit 1; fi

# From here on, shared application setup
WORKDIR /app

# Clean npm cache to reduce image size
RUN npm cache clean --force

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --verbose

# Copy application code
COPY . .

# Fix permissions (if needed)
RUN chmod -R 755 /app

# Run your app
CMD ["node", "index.js"]
