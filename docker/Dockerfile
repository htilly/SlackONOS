# Use the official Node.js image based on Debian Slim.
# Keep Node 22 while release builds include linux/arm/v7; node:26-slim does not publish arm/v7.
FROM node:22-slim AS base

# System deps needed for native builds (e.g., bcrypt) and git optional deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 build-essential git && \
    rm -rf /var/lib/apt/lists/* && \
    npm cache clean --force

# Set the working directory for your application
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install application dependencies reproducibly without dev dependencies
RUN npm ci --omit=dev --verbose

# Copy the rest of your application files
COPY . .

# Ensure proper permissions (if needed, adjust as necessary)
RUN chmod -R 755 /app

# Set GITHUB_REF as environment variable if provided (for release version detection)
# Accept GITHUB_REF as build arg and set as ENV
ARG GITHUB_REF
ENV GITHUB_REF=${GITHUB_REF}

# SlackONOS serves HTTP redirects/TTS on 8080 and HTTPS UI/API on 8443.
EXPOSE 8080 8443

# Command to run the application
CMD ["node", "index.js"]
