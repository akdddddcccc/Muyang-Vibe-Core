FROM node:20-alpine

WORKDIR /app
COPY services/live-sticker-api/src ./src

ENV NODE_ENV=production
ENV CORE_HOST=0.0.0.0
ENV CORE_PORT=8787

EXPOSE 8787
CMD ["node", "src/server.mjs"]
