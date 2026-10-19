FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force && \
    rm -rf /sbin/apk /etc/apk /lib/apk /usr/bin/wget /tmp/*

COPY src ./src
COPY public ./public
COPY bin ./bin

RUN mkdir -p /data/roms /data/saves /data/states /data/bios && \
    chown -R root:root /app && \
    chmod -R 555 /app && \
    chown -R node:node /data && \
    chmod -R 700 /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--disable-proto=delete", "--max-old-space-size=128", "src/server.js"]
