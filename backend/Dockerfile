# Railway: Chromium do sistema + fontes, em vez do Chrome baixado pelo Puppeteer.
# noto-color-emoji: a IA cita bios de Instagram, que vêm cheias de emoji.
# ffmpeg: converte/fatia gravações de reunião antes de mandar ao n8n transcrever.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

CMD ["node", "src/server.js"]
