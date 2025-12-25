ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8

RUN apk add --no-cache nodejs npm curl

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

RUN chmod a+x run.sh

CMD [ "/app/run.sh" ]
