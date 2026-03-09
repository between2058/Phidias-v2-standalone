import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

export async function POST(request: NextRequest) {
    try {
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

        let result: any[];

        if (ANTHROPIC_API_KEY) {
            result = await callAnthropic(base64, mime, system, user);
        } else if (OPENAI_API_KEY) {
            result = await callOpenAI(base64, mime, system, user);
        } else {
            return NextResponse.json(
                { error: 'No VLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env' },
                { status: 500 },
            );
        }

        return NextResponse.json({ parts: result });
    } catch (err: any) {
        console.error('[smart-organize]', err);
        return NextResponse.json(
            { error: err.message || 'Smart organize failed' },
            { status: 500 },
        );
    }
}

async function callAnthropic(b64: string, mime: string, system: string, user: string) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
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

async function callOpenAI(b64: string, mime: string, system: string, user: string) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL ?? 'gpt-4o',
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

    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return extractJson(data.choices?.[0]?.message?.content ?? '');
}

function extractJson(text: string): any[] {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in VLM response');
    return JSON.parse(match[0]);
}
