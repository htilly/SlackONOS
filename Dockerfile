# syntax=docker/dockerfile:1.4

# Stage for Node 24 (default for amd64 and arm64)
ARG TARGETPLATFORM
FROM --platform=$TARGETPLATFORM node:24.0-slim AS node24

# Stage for Node 23 (fallback for arm/v7)
ARG TARGETPLATFORM
FROM --platform=$TARGETPLATFORM node:23.0-slim AS node23

# Select base depending on platform
FROM node24 AS base
ARG TARGETPLATFORM
RUN if [ "$TARGETPLATFORM" = "linux/arm/v7" ]; then exit 1; fi

FROM node23 AS base
ARG TARGETPLATFORM
RUN if [ "$TARGETPLATFORM" != "linux/arm/v7" ]; then exit 1; fi

# Final build steps
WORKDIR /app
RUN npm cache clean --force
COPY package*.json ./
RUN npm install --verbose
COPY . .
RUN chmod -R 755 /app
CMD ["node", "index.js"]
