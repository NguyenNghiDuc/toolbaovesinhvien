FROM node:24-bookworm
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    DATABASE_URL=postgresql://build:build@localhost/build npm ci --fetch-retries=0 && \
    DATABASE_URL=postgresql://build:build@localhost/build npx prisma generate
COPY src ./src
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
