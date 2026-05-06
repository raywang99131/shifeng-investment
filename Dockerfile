FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.11-slim AS quote-builder
WORKDIR /app
COPY quote_service/requirements.txt ./
RUN pip install -r requirements.txt --no-cache-dir
COPY quote_service/ .

FROM node:20-alpine AS server-builder
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ .

FROM nginx:alpine
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
