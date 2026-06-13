FROM node:20-alpine
# Chromium p/ o Chat NCS gerar PDF em headless (a Ana não usa; fica disponível na imagem única)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV CHROME_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY package.json ./
# sem dependências externas (usa http + fetch nativos) — mas mantém o passo p/ futuro
RUN npm install --omit=dev || true
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
