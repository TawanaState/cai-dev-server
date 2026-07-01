# Use lightweight Node Alpine base image
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy application source code (server.js, index.html, etc.)
COPY . .

# Expose port 8001 (configured for host server guide access)
EXPOSE 8001

# Start the Node.js application
CMD ["npm", "start"]
