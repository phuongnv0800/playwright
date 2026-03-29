FROM mcr.microsoft.com/playwright:v1.51.1-noble

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY .env.example ./

RUN npm run build

CMD ["npm", "run", "start:api"]
