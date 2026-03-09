FROM debian:11-slim

#Create working dir
RUN useradd -ms /bin/bash prismServer

#Load dependencies

ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y gcc build-essential cmake default-jdk git bc zsh maven curl && rm -rf /var/lib/apt/lists/*

# Install Rust for building bw-responsibility
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

#build prism

WORKDIR /home/prismServer

RUN git clone https://github.com/prismmodelchecker/prism prism

WORKDIR /home/prismServer/prism/prism

RUN git checkout c541affb994f3ed044ae4e1dce3ed3dd078323be

WORKDIR /home/prismServer/prism/prism

RUN make

RUN make binary

# Build bw-responsibility tool from Zenodo artifact (DOI: 10.5281/zenodo.13738447)
WORKDIR /home/prismServer
RUN apt update && apt install -y unzip wget && rm -rf /var/lib/apt/lists/*
RUN wget -q -O actor-based-responsibility.zip "https://zenodo.org/api/records/13738447/files/actor-based-responsibility.zip/content"
RUN unzip -q actor-based-responsibility.zip
WORKDIR /home/prismServer/actor-based-responsibility
RUN /root/.cargo/bin/cargo build --release
RUN cp target/release/bw-responsibility /usr/local/bin/bw-responsibility

WORKDIR /home/prismServer

#Load everything into the image
COPY . server/

WORKDIR /home/prismServer/server

RUN mvn dependency:copy-dependencies

RUN mvn package -DskipTests

RUN sed -i 's/\r$//' bin/run && chmod +x bin/run

ENTRYPOINT ["bin/run", "server", "DockerDefault.yml"]

EXPOSE 8080
EXPOSE 8082
