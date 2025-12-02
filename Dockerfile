# Use the official Node.js image based on Debian Slim
# Note: ARM v7 requires Node 22 or lower, other platforms can use Node 25
ARG TARGETPLATFORM
FROM --platform=$TARGETPLATFORM node:25-slim AS base

# Clear npm cache to reduce image size and avoid potential issues
RUN npm cache clean --force

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

# Command to run the application
CMD ["node", "index.js"]
