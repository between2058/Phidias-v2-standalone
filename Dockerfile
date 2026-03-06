FROM node:18.15-alpine3.16

RUN apk add bash vim busybox-extras

ARG http_proxy
ARG https_proxy

ARG INSTALL_PATH=/app
WORKDIR ${INSTALL_PATH}

# Copy phidias source
ARG BUILD_FOLDER=""
ADD ${BUILD_FOLDER} ${INSTALL_PATH}

ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV HTTP_PROXY=${http_proxy}
ENV HTTPS_PROXY=${https_proxy}

RUN npm config set proxy ${http_proxy}
RUN npm config set https-proxy ${https_proxy}

RUN npm install -g pnpm@10.2.0
RUN rm -rf node_modules
RUN pnpm install

# Build Next.js in standalone output mode
RUN pnpm run build

RUN unset http_proxy
RUN unset https_proxy
RUN unset HTTP_PROXY
RUN unset HTTPS_PROXY

EXPOSE 3000

# next start serves the built app
CMD ["pnpm", "run", "start"]
