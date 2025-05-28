# syntax=docker/dockerfile:1.4

ARG TARGETPLATFORM

FROM node:24.0-slim AS node24
WORKDIR /app
COPY package*.json ./
RUN npm install --verbose
COPY . .

FROM node:23.0-slim AS node23
WORKDIR /app
COPY package*.json ./
RUN npm install --verbose
COPY . .

# Final stage — select correct one based on platform
FROM scratch AS selector

ARG TARGETPLATFORM

# For linux/arm/v7 use node23, else use node24
FROM node23 AS final-armv7
ARG TARGETPLATFORM
RUN [ "$TARGETPLATFORM" = "linux/arm/v7" ] || exit 1

FROM node24 AS final-other
ARG TARGETPLATFORM
RUN [ "$TARGETPLATFORM" != "linux/arm/v7" ] || exit 1

FROM final-armv7 AS base
ARG TARGETPLATFORM

FROM final-other AS base
ARG TARGETPLATFORM

# Final setup
WORKDIR /app
COPY --from=base /app /app
RUN chmod -R 755 /app
CMD ["node", "index.js"]
