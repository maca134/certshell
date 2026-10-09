const PROXY_IP = "172.31.0.2";

export function generate({
    proxy = "caddy",
    idp = "pocket-id",
    sshDomain = "ssh.example.com",
    idDomain = "id.example.com",
    issuer = "",
    caPassword = true,
    trustedProxies = "172.31.0.1",
    encryptionKey = "",
}) {
    const pid = idp === "pocket-id";
    const proxyName = { caddy: "Caddy", traefik: "Traefik" }[proxy];
    const files = {};

    const title = {
        caddy: " behind Caddy (automatic HTTPS)",
        traefik: " behind Traefik (Let's Encrypt)",
        none: "",
    }[proxy];
    let c = `# CertShell${pid ? " + Pocket ID" : ""}${title}. Setup steps: README.md → Quick start.\nname: certshell\n\nservices:\n`;

    const proxyNet = `    networks:
      default:
        ipv4_address: ${PROXY_IP}   # = certshell TRUSTED_PROXIES
${pid ? `        aliases: ["\${ID_DOMAIN}"]   # certshell reaches Pocket ID without hairpin NAT\n` : ""}`;
    const proxyEnv = `    environment:
      SSH_DOMAIN: \${SSH_DOMAIN}
${pid ? `      ID_DOMAIN: \${ID_DOMAIN}\n` : ""}`;

    if (proxy === "caddy") {
        c += `  caddy:
    image: caddy:2
    restart: unless-stopped
${proxyEnv}    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    ports: ["80:80", "443:443"]
${proxyNet}
`;
        files.Caddyfile = `{$SSH_DOMAIN} {\n\treverse_proxy certshell:3000\n}\n${pid ? "\n{$ID_DOMAIN} {\n\treverse_proxy pocket-id:1411\n}\n" : ""}`;
    } else if (proxy === "traefik") {
        c += `  traefik:
    image: traefik:v3
    restart: unless-stopped
${proxyEnv}    command:
      - --providers.file.filename=/etc/traefik/routes.yml
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.websecure.address=:443
      - --entrypoints.websecure.http.tls.certresolver=le
      - --certificatesresolvers.le.acme.tlschallenge=true
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports: ["80:80", "443:443"]
    volumes:
      - ./routes.yml:/etc/traefik/routes.yml:ro
      - letsencrypt:/letsencrypt
${proxyNet}
`;
        files["routes.yml"] = `http:
  routers:
    certshell:
      rule: Host(\`{{ env "SSH_DOMAIN" }}\`)
      service: certshell
${
    pid
        ? `    pocket-id:
      rule: Host(\`{{ env "ID_DOMAIN" }}\`)
      service: pocket-id
`
        : ""
}  services:
    certshell:
      loadBalancer:
        servers: [{ url: "http://certshell:3000" }]
${
    pid
        ? `    pocket-id:
      loadBalancer:
        servers: [{ url: "http://pocket-id:1411" }]
`
        : ""
}`;
    }

    c += `  certshell:
    image: ghcr.io/maca134/certshell:1
    init: true
    restart: unless-stopped
    environment:
      APP_URL: https://\${SSH_DOMAIN}
      OIDC_ISSUER: ${pid ? `https://\${ID_DOMAIN}` : `\${OIDC_ISSUER}`}
      OIDC_CLIENT_ID: \${OIDC_CLIENT_ID}
      OIDC_CLIENT_SECRET: \${OIDC_CLIENT_SECRET}
      TRUSTED_PROXIES: ${proxy === "none" ? trustedProxies : PROXY_IP}
${caPassword ? "    secrets: [ca_password]\n" : ""}${proxy === "none" ? `    ports: ["127.0.0.1:3000:3000"]\n` : ""}    volumes: ["certshell-data:/data"]
    read_only: true
    tmpfs: ["/tmp:noexec,nosuid,size=16m"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    pids_limit: 256
    mem_limit: 512m
`;
    if (pid) {
        c += `
  pocket-id:
    image: ghcr.io/pocket-id/pocket-id:v2
    restart: unless-stopped
    environment:
      APP_URL: https://\${ID_DOMAIN}
      TRUST_PROXY: "true"
      ENCRYPTION_KEY: \${POCKET_ID_ENCRYPTION_KEY}
${proxy === "none" ? `    ports: ["127.0.0.1:1411:1411"]\n` : ""}    volumes: ["pocket-id-data:/app/data"]
`;
    }
    if (caPassword)
        c += "\nsecrets:\n  ca_password: { file: ./secrets/ca_password }\n";
    c += `\nvolumes:\n${{ caddy: "  caddy-data: {}\n", traefik: "  letsencrypt: {}\n", none: "" }[proxy]}  certshell-data: {}\n${pid ? "  pocket-id-data: {}\n" : ""}`;
    c +=
        "\nnetworks:\n  default:\n    ipam: { config: [{ subnet: 172.31.0.0/24, ip_range: 172.31.0.128/25 }] }\n";
    files["compose.yaml"] = c;

    const names = pid
        ? "Both names must resolve to this server"
        : "Must resolve to this server";
    const certs = {
        caddy: "Caddy gets their certificates.",
        traefik: "Traefik gets their certificates (Let's Encrypt).",
    }[proxy];
    let env =
        proxy === "none"
            ? "# Your reverse proxy terminates HTTPS and forwards to 127.0.0.1:3000" +
              (pid ? " / :1411" : "") +
              "\n"
            : `# ${names}; ${pid ? certs : certs.replace("their certificates", "its certificate")}\n`;
    env += `SSH_DOMAIN=${sshDomain}\n`;
    if (pid)
        env += `ID_DOMAIN=${idDomain}\n\n# openssl rand -base64 32\nPOCKET_ID_ENCRYPTION_KEY=${encryptionKey}\n\n# From Pocket ID once the OIDC client exists (README.md → Quick start)\n`;
    else
        env += `OIDC_ISSUER=${issuer}\n\n# From your IdP's OIDC client (callback https://${sshDomain}/auth/callback)\n`;
    env += "OIDC_CLIENT_ID=\nOIDC_CLIENT_SECRET=\n";
    files[".env"] = env;

    const setup = [];
    if (pid && !encryptionKey)
        setup.push(
            `sed -i "s|^POCKET_ID_ENCRYPTION_KEY=$|POCKET_ID_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env`,
        );
    if (caPassword)
        setup.push(
            "mkdir -p secrets && (test -f secrets/ca_password || openssl rand -base64 32 > secrets/ca_password)",
            "chown 1000:1000 secrets/ca_password && chmod 600 secrets/ca_password",
        );
    if (pid)
        setup.push(
            `docker compose up -d${proxyName ? ` ${proxy}` : ""} pocket-id`,
            `# set up Pocket ID at https://${idDomain}/setup, add OIDC client`,
        );
    const next = [
        `# callback URL: https://${sshDomain}/auth/callback`,
        "# put the client ID and secret in .env, then:",
    ];
    const steps = [
        "mkdir certshell && cd certshell",
        `# save ${Object.keys(files).join(", ")} here`,
        ...setup,
        ...next,
        "docker compose up -d",
    ];
    const heredocs = Object.entries(files).map(
        ([name, text]) => `cat > ${name} <<'EOF'\n${text}EOF\n`,
    );
    const script = [
        "mkdir -p certshell && cd certshell\n",
        ...heredocs,
        ...setup,
        "",
        ...next,
        "#   docker compose up -d",
    ];

    return { files, steps: steps.join("\n"), script: script.join("\n") };
}

export function installCommand(origin, o) {
    const q = new URLSearchParams({
        proxy: o.proxy,
        idp: o.idp,
        sshDomain: o.sshDomain,
    });
    if (o.idp === "pocket-id") q.set("idDomain", o.idDomain);
    else q.set("issuer", o.issuer);
    if (o.proxy === "none") q.set("trustedProxies", o.trustedProxies);
    if (!o.caPassword) q.set("caPassword", "0");
    return `curl -fsSL '${origin}/install?${q}' | sh\n`;
}
