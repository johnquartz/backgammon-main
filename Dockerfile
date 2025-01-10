FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Use PORT environment variable
ENV PORT=3000
EXPOSE $PORT

CMD ["node", "bot.js"] 