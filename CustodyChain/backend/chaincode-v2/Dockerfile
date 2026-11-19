# Runs the v2 evidence chaincode as an external service (CCaaS, D-003).
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY lib ./lib
EXPOSE 9999
CMD npx fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID
