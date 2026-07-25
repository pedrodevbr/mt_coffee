FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p uploads/receipts

# Porta padrão; a Railway injeta PORT em tempo de execução e o server.js respeita.
EXPOSE 5000

CMD ["node", "server.js"]
