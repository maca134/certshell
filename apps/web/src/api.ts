import type { ApiError } from "@repo/shared";

export async function api<T = void>(
    path: string,
    method = "GET",
    body?: unknown,
): Promise<T> {
    const res = await fetch(path, {
        method,
        headers:
            body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
        location.href = "/auth/login";
        throw new Error("signed out");
    }
    if (!res.ok) {
        const err = (await res.json().catch(() => undefined)) as
            | ApiError
            | undefined;
        throw new Error(err?.error ?? `${res.status} ${res.statusText}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
}
