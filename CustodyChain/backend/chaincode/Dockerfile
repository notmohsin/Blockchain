# Run-only wrapper: serves the authors' unmodified chaincode as an external service (CCaaS).
# Needed because Docker 29+ breaks the Fabric peer's built-in chaincode image build.
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY lib ./lib
EXPOSE 9999
CMD npx fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID
