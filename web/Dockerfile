FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Build-time identity arguments — injected during image build.
# APP_VERSION: human-readable release label (e.g. "v0.4").
# GIT_SHA:     full or short commit SHA of the source tree.
ARG APP_VERSION="dev"
ARG GIT_SHA=""

ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}

EXPOSE 8080

CMD ["npm", "start"]