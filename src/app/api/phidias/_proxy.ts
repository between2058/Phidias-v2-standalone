import { NextRequest, NextResponse } from 'next/server';

/**
 * Generic reverse-proxy helper for Next.js App Router API routes.
 * Streams the upstream response body directly — efficient for large files (GLB, MP4).
 */
export async function proxyRequest(
    request: NextRequest,
    targetUrl: string,
): Promise<NextResponse> {
    const headers = new Headers();
    request.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        // Strip hop-by-hop headers that must not be forwarded
        if (!['host', 'connection', 'transfer-encoding'].includes(lower)) {
            headers.set(key, value);
        }
    });

    let body: BodyInit | undefined;
    if (!['GET', 'HEAD'].includes(request.method)) {
        const buf = await request.arrayBuffer();
        if (buf.byteLength > 0) body = buf;
    }

    const upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body,
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (!['transfer-encoding', 'connection'].includes(lower)) {
            responseHeaders.set(key, value);
        }
    });

    return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
    });
}
