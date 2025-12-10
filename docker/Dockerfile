# Use the official Node.js image based on Debian Slim
# Note: ARM v7 requires Node 22 or lower, other platforms can use Node 25
ARG TARGETPLATFORM
ARG GITHUB_REF=""
FROM --platform=$TARGETPLATFORM node:22-slim AS base

# System deps needed for native builds (e.g., bcrypt) and git optional deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    npm cache clean --force

# Set the working directory for your application
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install application dependencies
RUN npm install --verbose

# Copy the rest of your application files
COPY . .

# Ensure proper permissions (if needed, adjust as necessary)
RUN chmod -R 755 /app

# Set GITHUB_REF as environment variable if provided (for release version detection)
ENV GITHUB_REF=${GITHUB_REF}

# Command to run the application
CMD ["node", "index.js"]
