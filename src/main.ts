import { app } from "./app";
import { ensureCa, readCaPassword } from "./ca";

await ensureCa(
    "/data/ca",
    process.env.CA_NAME || "web-ssh",
    await readCaPassword(),
);

const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`listening on :${server.port}`);
