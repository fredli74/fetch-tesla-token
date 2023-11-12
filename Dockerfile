FROM node:18.18-alpine3.18 as builder
WORKDIR /app

COPY package.json  /app/

RUN yarn install

FROM node:18.18-alpine3.18
WORKDIR /app

COPY --from=builder /app/node_modules /app/node_modules
COPY . /app/

EXPOSE 3000

ENV LISTEN_PORT=3000
ENV LISTEN_HOST=0.0.0.0

CMD ["yarn", "run", "start"]
