FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3871

# Copy dependency manifests
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Pre-create data directories
RUN mkdir -p data/sessions data/qr data/logs config

EXPOSE 3871

VOLUME ["/app/data", "/app/config"]

CMD ["node", "src/cli.js", "serve"]
