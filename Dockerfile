FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
COPY server/cds_pricing/requirements.txt /tmp/cds-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && python3 -m venv /opt/cds-python \
    && /opt/cds-python/bin/pip install --no-cache-dir -r /tmp/cds-requirements.txt \
    && rm -rf /var/lib/apt/lists/*
ENV ICE_CDS_PYTHON=/opt/cds-python/bin/python
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/package*.json .
EXPOSE 3000
CMD ["node", "server/index.js"]
