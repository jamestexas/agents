FROM node:22-bookworm-slim
WORKDIR /app
COPY test/fixtures/canonical-hours-server.mjs ./server.mjs
EXPOSE 8790
CMD ["node", "server.mjs"]
