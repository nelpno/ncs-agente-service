FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# sem dependências externas (usa http + fetch nativos) — mas mantém o passo p/ futuro
RUN npm install --omit=dev || true
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
