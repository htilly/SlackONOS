FROM node:12 as intermediate
LABEL stage=intermediate

RUN apt-get update && \
    apt-get install -y git && \
    git clone https://github.com/htilly/zenmusic.git

FROM node:12
RUN mkdir app
COPY --from=intermediate /zenmusic/* /app/
WORKDIR /app
COPY . .
RUN npm install

CMD [ "node", "index.js" ]
