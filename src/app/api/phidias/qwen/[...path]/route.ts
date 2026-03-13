import { NextRequest } from 'next/server';
import { proxyRequest } from '../../_proxy';

const QWEN_BASE = process.env.QWEN_API_URL ?? 'http://172.18.246.141:8190';

/**
 * Map frontend URL path segments → Qwen API path.
 *
 * Frontend calls:
 *   POST /api/phidias/qwen/text2img          → /text2img
 *   POST /api/phidias/qwen/edit              → /edit
 *   POST /api/phidias/qwen/angle/custom      → /angle  (mode=custom already in body)
 *   POST /api/phidias/qwen/angle/multi       → /angle  (mode=multi already in body)
 *   GET  /api/phidias/qwen/download/{id}/… → /download/{id}/…
 */
function qwenPath(segments: string[]): string {
    if (segments[0] === 'angle') return '/angle';
    return '/' + segments.join('/');
}

export async function GET(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    return proxyRequest(request, QWEN_BASE + qwenPath(params.path));
}

export async function POST(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    return proxyRequest(request, QWEN_BASE + qwenPath(params.path));
}
