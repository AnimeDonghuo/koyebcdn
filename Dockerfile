FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node catalog.js server.js mtproto.js telegram-link.js store.js ./
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production PORT=8000
EXPOSE 8000
CMD ["node", "server.js"]
