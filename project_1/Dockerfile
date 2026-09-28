FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY db ./db

USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm start"]
