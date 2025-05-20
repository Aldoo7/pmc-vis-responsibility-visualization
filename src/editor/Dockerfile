FROM debian:11-slim

#Create working dir
RUN useradd -ms /bin/bash codeuser
WORKDIR /home/codeuser

#Load dependencies

ENV DEBIAN_FRONTEND=noninteractive
# Install prerequisites
RUN apt update && apt install -y \
    curl \
    wget \
    sudo \
    build-essential &&\
    curl -sL https://deb.nodesource.com/setup_20.x | bash && \
    apt-get install nodejs -y && \
    rm -rf /var/lib/apt/lists/* &&\
    node -v && npm -v


RUN npm install -g @vscode/vsce

# Install Code-Server (VS Code in the browser)
RUN curl -fsSL https://code-server.dev/install.sh | sh

COPY . editor/
WORKDIR /home/codeuser/editor
RUN sed -i 's/localhost/host.docker.internal/g' src/constants.js
RUN vsce package

ENV VSCODE_PROXY_URI=

RUN code-server --install-extension PMC-VIS-0.0.1.vsix

# Working dir for Code-Server
WORKDIR /home/codeuser/editor

# Expose port for Code-Server
EXPOSE 3001
EXPOSE 3002

# Start Code-Server on container launch
CMD ["code-server", "--bind-addr", "0.0.0.0:3002", "--auth", "none", "./data"]