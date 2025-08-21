FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apk add --no-cache udev chromium chromium-dev harfbuzz-icu openjdk17-jre-headless && npx playwright install --with-deps

EXPOSE 3000

CMD ["node", "index.js"]