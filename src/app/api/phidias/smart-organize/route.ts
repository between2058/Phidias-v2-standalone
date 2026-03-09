import { NextRequest, NextResponse } from 'next/server';

// ── VLM configuration via environment variables ──────────────────────────────
// VLM_API_URL : base URL (e.g. https://api.openai.com/v1, or a self-hosted endpoint)
// VLM_API_KEY : bearer token / API key
// VLM_MODEL   : model name  (default: gpt-4o)
//
// Supports any OpenAI-compatible chat-completion endpoint (OpenAI, Azure,
// vLLM, Ollama, LM Studio, Together, etc.) and Anthropic Messages API.
// The route auto-detects Anthropic when the URL contains "anthropic".

const VLM_API_URL = process.env.VLM_API_URL ?? '';
const VLM_API_KEY = process.env.VLM_API_KEY ?? '';
const VLM_MODEL = process.env.VLM_MODEL ?? 'gpt-4o';

function isAnthropic(): boolean {
    return VLM_API_URL.includes('anthropic');
}

export async function POST(request: NextRequest) {
    try {
        if (!VLM_API_URL || !VLM_API_KEY) {
            return NextResponse.json(
                { error: 'VLM not configured. Set VLM_API_URL and VLM_API_KEY in .env' },
                { status: 500 },
            );
        }

        const formData = await request.formData();
        const screenshot = formData.get('screenshot') as File | null;
        const partsJson = formData.get('parts') as string | null;

        if (!screenshot || !partsJson) {
            return NextResponse.json(
                { error: 'Missing screenshot or parts data' },
                { status: 400 },
            );
        }

        const parts: { id: string; color: string }[] = JSON.parse(partsJson);
        const buf = Buffer.from(await screenshot.arrayBuffer());
        const base64 = buf.toString('base64');
        const mime = screenshot.type || 'image/png';

        const system = [
            'You are a 3D asset analyst.',
            'You are shown a screenshot of a segmented 3D model where each part is a different color.',
            'Identify what each colored part represents and suggest logical groups.',
            'Return ONLY a valid JSON array — no markdown fences, no explanation.',
        ].join(' ');

        const user = [
            `This 3D model has ${parts.length} segmented parts with these colors:`,
            ...parts.map((p) => `- ${p.id}: ${p.color}`),
            '',
            'Return a JSON array naming each part and grouping related parts:',
            '[{"id":"part_0","name":"Seat","group":"Body"},...]',
            '',
            'Rules:',
            '- Use concise, descriptive English names (e.g. "Front Left Leg", "Seat Cushion")',
            '- Group related parts (e.g. all legs → "Legs", body panels → "Body")',
            '- Every part must appear exactly once',
            '- Return ONLY the JSON array',
        ].join('\n');

        const result = isAnthropic()
            ? await callAnthropic(base64, mime, system, user)
            : await callOpenAICompat(base64, mime, system, user);

        return NextResponse.json({ parts: result });
    } catch (err: any) {
        console.error('[smart-organize]', err);
        return NextResponse.json(
            { error: err.message || 'Smart organize failed' },
            { status: 500 },
        );
    }
}

// ── Anthropic Messages API ──────────────────────────────────────────────────

async function callAnthropic(b64: string, mime: string, system: string, user: string) {
    const url = VLM_API_URL.replace(/\/+$/, '');
    const endpoint = url.endsWith('/messages') ? url : `${url}/v1/messages`;

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': VLM_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: VLM_MODEL,
            max_tokens: 4096,
            system,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
                        { type: 'text', text: user },
                    ],
                },
            ],
        }),
    });

    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return extractJson(data.content?.[0]?.text ?? '');
}

// ── OpenAI-compatible chat completions ──────────────────────────────────────

async function callOpenAICompat(b64: string, mime: string, system: string, user: string) {
    const url = VLM_API_URL.replace(/\/+$/, '');
    const endpoint = url.endsWith('/chat/completions')
        ? url
        : `${url}/chat/completions`;

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${VLM_API_KEY}`,
        },
        body: JSON.stringify({
            model: VLM_MODEL,
            max_tokens: 4096,
            messages: [
                { role: 'system', content: system },
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
                        { type: 'text', text: user },
                    ],
                },
            ],
        }),
    });

    if (!res.ok) throw new Error(`VLM API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return extractJson(data.choices?.[0]?.message?.content ?? '');
}

function extractJson(text: string): any[] {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in VLM response');
    return JSON.parse(match[0]);
}
