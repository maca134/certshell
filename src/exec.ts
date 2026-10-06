// Not Bun's `$`: it silently drops empty-string args, so `-N ${""}` becomes a bare `-N`.
export async function run(cmd: string[]) {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0)
        throw new Error(`${cmd[0]} exited ${code}: ${stderr.trim()}`);
    return stdout;
}
