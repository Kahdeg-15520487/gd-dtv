FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache rclone
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache rclone
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ENV PORT=3000
USER node
EXPOSE 3000
CMD ["node", "dist/web/server.js"]
