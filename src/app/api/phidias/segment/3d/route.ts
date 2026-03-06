import { NextRequest } from 'next/server';
import { proxyRequest } from '../../_proxy';

const P3SAM_BASE = process.env.P3SAM_API_URL ?? 'http://172.18.246.141:5001';

/**
 * POST /api/phidias/segment/3d → POST http://P3SAM/segment
 */
export async function POST(request: NextRequest) {
    return proxyRequest(request, `${P3SAM_BASE}/segment`);
}
