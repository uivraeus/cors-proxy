FROM node:16-alpine

COPY ./package.json /cors-prox/
COPY ./package-lock.json /cors-prox/
COPY ./src/* /cors-prox/

ARG APP_GROUP_UID=2000
ARG APP_USER_UID=2000
RUN addgroup -S -g ${APP_GROUP_UID} appgroup && adduser -S -u ${APP_USER_UID} appuser -G appgroup
RUN chown -R appuser /cors-prox
USER appuser

WORKDIR /cors-prox
RUN npm ci

CMD ["node", "app.mjs"]
