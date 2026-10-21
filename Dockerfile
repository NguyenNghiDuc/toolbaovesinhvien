FROM node:24-bookworm
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --omit=dev --fetch-retries=0
COPY src ./src
COPY public ./public
RUN mkdir -p data && chown node:node data
USER node
ENV HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "src/server.js"]
