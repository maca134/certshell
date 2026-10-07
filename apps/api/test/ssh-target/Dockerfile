# Dev/test SSH target: plain sshd + curl, enrolled through the web UI snippet.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd && \
    useradd -m -s /bin/bash -p '*' alice
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
