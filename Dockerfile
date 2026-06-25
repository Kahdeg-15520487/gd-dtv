FROM node:24-alpine
RUN apk add --no-cache rclone
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
ENV PORT=3000
USER node
EXPOSE 3000
CMD ["node", "dist/web/server.js"]
