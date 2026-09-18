# Railway: Chromium do sistema + fontes, em vez do Chrome baixado pelo Puppeteer.
# noto-color-emoji: a IA cita bios de Instagram, que vêm cheias de emoji.
#: pdftotext, usado no upload (o extrator de PDF do n8n perde letras em alguns arquivos).
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

CMD ["node", "src/server.js"]
