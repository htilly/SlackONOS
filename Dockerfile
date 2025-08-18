# Use the official Node.js image based on Alpine Linux
# The --platform flag is used here to make sure we use a multi-platform base image
FROM --platform=$TARGETPLATFORM node:24.6-slim AS base

# Update and install git (if needed for your application)
#RUN apk update && \
#    apk upgrade

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
