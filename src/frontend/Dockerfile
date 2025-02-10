FROM ubuntu:18.04
WORKDIR /usr/src/pmc-vis

### 1. node 20
RUN apt-get update && \
    apt-get install -y curl gnupg build-essential && \
    curl --silent --location https://deb.nodesource.com/setup_20.x | bash - && \
    curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - && \
    echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list && \
    apt-get remove -y --purge cmdtest && \
    apt-get update && \
    apt-get install -y nodejs yarn && \
    # remove useless files from the current layer
    rm -rf /var/lib/apt/lists/* && \
    rm -rf /var/lib/apt/lists.d/* && \
    apt-get autoremove && \
    apt-get clean && \
    apt-get autoclean

### 2. install app
COPY . ./
RUN npm install

EXPOSE 3000
ENTRYPOINT ["npm", "start"]
