FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY quote_service/requirements.txt ./
RUN pip install -r requirements.txt --no-cache-dir
COPY quote_service/ .
EXPOSE 3001
CMD ["python3", "main.py"]

FROM node:20-alpine AS server-builder
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ .
EXPOSE 3000
CMD ["node", "index.js"]
