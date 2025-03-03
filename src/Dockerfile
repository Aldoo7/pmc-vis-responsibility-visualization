FROM ubuntu:25.04
WORKDIR /usr/src/pmc-vis
ENV DEBIAN_FRONTEND=noninteractive

### 1. node 20
RUN apt-get update && \
    apt-get install curl -y && \
    curl -sL https://deb.nodesource.com/setup_20.x | bash && \
    apt-get install nodejs -y && \
    node -v && npm -v

### 2. install prism
WORKDIR /usr/src/pmc-vis/backend/
RUN git clone https://github.com/prismmodelchecker/prism prism
WORKDIR /usr/src/pmc-vis/backend/prism/prism
RUN git checkout c541affb994f3ed044ae4e1dce3ed3dd078323be
RUN make

### 3. install backend server
WORKDIR /usr/src/pmc-vis/backend/server
COPY backend/server ./
RUN mvn dependency:copy-dependencies
RUN mvn package
RUN sed -i 's/\r$//' bin/run && chmod +x bin/run

### 4. install frontend server
WORKDIR /usr/src/pmc-vis/frontend/
COPY frontend ./
RUN npm install

### 5 install scripts
WORKDIR /usr/src/pmc-vis/
COPY scripts scripts
RUN chmod +x scripts/*

EXPOSE 3000
EXPOSE 8080
ENTRYPOINT ["scripts/wrapper.sh"]
