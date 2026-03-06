import { NextRequest } from 'next/server';
import { proxyRequest } from '../../_proxy';

const RECONVIAGEN_BASE = process.env.RECONVIAGEN_API_URL ?? 'http://172.18.246.141:52069';

/**
 * Proxy all ReconViaGen calls 1-to-1:
 *   POST /api/phidias/reconviagen/generate-single → /generate-single
 *   POST /api/phidias/reconviagen/generate-multi  → /generate-multi
 *   POST /api/phidias/reconviagen/generate-batch  → /generate-batch
 *   GET  /api/phidias/reconviagen/download/{id}/… → /download/{id}/…
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    return proxyRequest(request, RECONVIAGEN_BASE + '/' + params.path.join('/'));
}

export async function POST(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    return proxyRequest(request, RECONVIAGEN_BASE + '/' + params.path.join('/'));
}
