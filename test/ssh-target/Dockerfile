# Dev/test SSH target configured per SPEC §4 (hostId dev00001).
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && \
    rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd && \
    useradd -m -s /bin/bash -p '*' alice
COPY 50-web-ssh.conf /etc/ssh/sshd_config.d/
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
