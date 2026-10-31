FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    CHROME_BIN=/usr/bin/chromium \
    HOME=/home/node \
    NODE_OPTIONS=--max-old-space-size=256

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        dumb-init \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY app.js index.js ./
COPY adapters ./adapters
COPY application ./application
COPY config ./config
COPY domain ./domain

RUN chown -R node:node /app
USER node

EXPOSE 8800

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
