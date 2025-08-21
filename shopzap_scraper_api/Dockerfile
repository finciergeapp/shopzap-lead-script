FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apk add --no-cache udev chromium harfbuzz-icu openjdk17-jre-headless && \
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 && \
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["node", "index.js"]