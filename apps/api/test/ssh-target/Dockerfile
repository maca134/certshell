# Dev/test SSH target: plain sshd + curl, enrolled through the web UI snippet.
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd && \
    useradd -m -s /bin/bash -p '*' alice
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
