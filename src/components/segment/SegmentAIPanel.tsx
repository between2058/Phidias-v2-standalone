'use client';

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface P3SAMParams {
    // P3-SAM / Auto params
    point_num: number;
    prompt_num: number;
    threshold: number;
    prompt_bs: number;
    post_process: boolean;
    clean_mesh_flag: boolean;
    save_mid_res: boolean;
    seed: number;
    randomize_seed: boolean;
}

export interface SegmentResult {
    id: string;
    name: string;
    color: string;
    score: number; // IoU confidence, 0–1
    meshIds: string[];
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: P3SAMParams = {
    // P3-SAM defaults from auto_mask.py
    point_num: 100000,
    prompt_num: 400,
    threshold: 0.95,
    prompt_bs: 32,
    post_process: true,
    clean_mesh_flag: true,
    save_mid_res: false,
    seed: 42,
    randomize_seed: false,
};

const PARAM_DESCRIPTIONS: Record<string, string> = {
    point_num: 'Surface sampling density (point_num). More points = finer detail but slower inference.',
    prompt_num: 'Farthest-point-sampled prompts spread across the mesh (prompt_num). Covers the surface evenly.',
    threshold: 'Minimum area ratio for a region to survive post-processing (threshold). Higher = fewer, larger parts.',
    prompt_bs: 'GPU inference batch size (prompt_bs). Reduce if you get out-of-memory errors.',
    post_process: 'AABB-based region merging and gap filling after mask prediction (post_process).',
    clean_mesh_flag: 'Remove degenerate faces and merge near-duplicate vertices before processing (clean_mesh_flag).',
    save_mid_res: 'Persist intermediate meshes (point cloud, clusters, AABB views) to the output directory (save_mid_res).',
    seed: 'RNG seed for reproducibility. Use the dice button to randomize.',
    multimask_output: 'Return three mask candidates per prompt ranked by confidence — lets you pick the best one.',
    use_previous_mask: 'Use the previous segmentation result as a warm start for the next prediction.',
};

// ─── Low-level UI primitives ──────────────────────────────────────────────────

function SectionHeader({
    label,
    open,
    onToggle,
}: {
    label: string;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            onClick={onToggle}
            className="w-full flex items-center justify-between px-3 py-2 transition-colors hover:bg-[#252542]"
        >
            <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: '#64748b' }}
            >
                {label}
            </span>
            <span className="text-[9px]" style={{ color: '#4b5563' }}>
                {open ? '▼' : '▶'}
            </span>
        </button>
    );
}

function SliderRow({
    label,
    paramKey,
    value,
    min,
    max,
    step = 1,
    displayValue,
    onChange,
}: {
    label: string;
    paramKey: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    displayValue: string;
    onChange: (v: number) => void;
}) {
    const pct = ((value - min) / (max - min)) * 100;
    return (
        <div className="px-3 pb-3" title={PARAM_DESCRIPTIONS[paramKey]}>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                    {label}
                </span>
                <span
                    className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: '#252542', color: '#a78bfa' }}
                >
                    {displayValue}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none"
                style={{
                    background: `linear-gradient(to right, #7c3aed ${pct}%, #252542 ${pct}%)`,
                }}
            />
            <div className="flex justify-between mt-0.5">
                <span className="text-[9px]" style={{ color: '#4b5563' }}>
                    {min}
                </span>
                <span className="text-[9px]" style={{ color: '#4b5563' }}>
                    {max}
                </span>
            </div>
        </div>
    );
}

function ToggleRow({
    label,
    paramKey,
    value,
    onChange,
}: {
    label: string;
    paramKey: string;
    value: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div
            className="flex items-center justify-between px-3 pb-3"
            title={PARAM_DESCRIPTIONS[paramKey]}
        >
            <span className="text-xs" style={{ color: '#94a3b8' }}>
                {label}
            </span>
            <button
                onClick={() => onChange(!value)}
                className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                style={{ background: value ? '#7c3aed' : '#252542' }}
                aria-checked={value}
                role="switch"
            >
                <div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                    style={{ transform: value ? 'translateX(17px)' : 'translateX(2px)' }}
                />
            </button>
        </div>
    );
}

// ─── Results Row ─────────────────────────────────────────────────────────────

function ResultRow({ result }: { result: SegmentResult }) {
    const scoreColor =
        result.score >= 0.9 ? '#22c55e' : result.score >= 0.7 ? '#f59e0b' : '#ef4444';

    return (
        <div
            className="flex items-center gap-2 px-3 py-2 hover:bg-[#252542] transition-colors"
        >
            <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: result.color }}
            />
            <span className="flex-1 text-xs text-white truncate">{result.name}</span>
            <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: `${scoreColor}22`, color: scoreColor }}
            >
                {result.score.toFixed(2)}
            </span>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface SegmentAIPanelProps {
    /** Whether a model is loaded — enables the Start button */
    isEnabled: boolean;
    isSegmenting: boolean;
    progress: number;
    error: string | null;
    results: SegmentResult[];
    onStart: (params: P3SAMParams) => void;
    onCancel: () => void;
    onSmartOrganize?: () => void;
    isOrganizing?: boolean;
}

type SectionKey = 'sampling' | 'detection' | 'postprocess' | 'advanced';

export default function SegmentAIPanel({
    isEnabled,
    isSegmenting,
    progress,
    error,
    results,
    onStart,
    onCancel,
    onSmartOrganize,
    isOrganizing,
}: SegmentAIPanelProps) {
    const [params, setParams] = useState<P3SAMParams>(DEFAULT_PARAMS);
    const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
        sampling: true,
        detection: true,
        postprocess: true,
        advanced: false,
    });

    const setParam = useCallback(
        <K extends keyof P3SAMParams>(key: K, value: P3SAMParams[K]) => {
            setParams(prev => ({ ...prev, [key]: value }));
        },
        []
    );

    const toggleSection = (key: SectionKey) => {
        setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleStart = () => {
        const finalParams =
            params.randomize_seed
                ? { ...params, seed: Math.floor(Math.random() * 2_147_483_647) }
                : params;
        onStart(finalParams);
    };

    const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v));

    return (
        <div className="flex flex-col h-full">
            <style jsx>{`
                .btn-gradient { position: relative; overflow: hidden; }
                .gradient-bg { position: absolute; inset: 0; border-radius: inherit; }
                .bg1 { background: linear-gradient(135deg, #22c55e, #f5a623); }
                .bg2 { background: linear-gradient(135deg, #f5a623, #22c55e); opacity: 0; }

                @keyframes bgFade {
                    0% { opacity: 0; }
                    50% { opacity: 1; }
                    100% { opacity: 0; }
                }
                .bg2.animate { animation: bgFade 1s ease-in-out infinite; }

                .btn-content { position: relative; z-index: 2; display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; }

                .spinner { width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.12); border-top-color: #1a1a2e; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite; }
                @keyframes spin { to { transform: rotate(360deg); } }

                button.disabled-btn .btn-content { opacity: 0.5; }
                button.disabled-btn .gradient-bg { filter: grayscale(1) opacity(0.2); }

            `}</style>
            {/* ── Scrollable Params ─────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">

                {/* ──────── AUTO MODE PARAMS ──────── */}
                <>
                    {/* Sampling */}
                    <div className="border-b" style={{ borderColor: '#333355' }}>
                        <SectionHeader
                            label="Sampling"
                            open={openSections.sampling}
                            onToggle={() => toggleSection('sampling')}
                        />
                        {openSections.sampling && (
                            <div className="pt-1">
                                <SliderRow
                                    label="Point Density"
                                    paramKey="point_num"
                                    value={params.point_num}
                                    min={10000}
                                    max={500000}
                                    step={10000}
                                    displayValue={fmtK(params.point_num)}
                                    onChange={v => setParam('point_num', v)}
                                />
                                <SliderRow
                                    label="Prompt Points"
                                    paramKey="prompt_num"
                                    value={params.prompt_num}
                                    min={50}
                                    max={1000}
                                    step={50}
                                    displayValue={String(params.prompt_num)}
                                    onChange={v => setParam('prompt_num', v)}
                                />
                            </div>
                        )}
                    </div>

                    {/* Detection */}
                    <div className="border-b" style={{ borderColor: '#333355' }}>
                        <SectionHeader
                            label="Detection"
                            open={openSections.detection}
                            onToggle={() => toggleSection('detection')}
                        />
                        {openSections.detection && (
                            <div className="pt-1">
                                <SliderRow
                                    label="Area Threshold"
                                    paramKey="threshold"
                                    value={params.threshold}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    displayValue={params.threshold.toFixed(2)}
                                    onChange={v => setParam('threshold', v)}
                                />
                                <SliderRow
                                    label="Batch Size"
                                    paramKey="prompt_bs"
                                    value={params.prompt_bs}
                                    min={4}
                                    max={128}
                                    step={4}
                                    displayValue={String(params.prompt_bs)}
                                    onChange={v => setParam('prompt_bs', v)}
                                />
                            </div>
                        )}
                    </div>

                    {/* Post-Processing */}
                    <div className="border-b" style={{ borderColor: '#333355' }}>
                        <SectionHeader
                            label="Post-Processing"
                            open={openSections.postprocess}
                            onToggle={() => toggleSection('postprocess')}
                        />
                        {openSections.postprocess && (
                            <div className="pt-1">
                                <ToggleRow
                                    label="Post-Process"
                                    paramKey="post_process"
                                    value={params.post_process}
                                    onChange={v => setParam('post_process', v)}
                                />
                                <ToggleRow
                                    label="Clean Mesh"
                                    paramKey="clean_mesh_flag"
                                    value={params.clean_mesh_flag}
                                    onChange={v => setParam('clean_mesh_flag', v)}
                                />
                                <ToggleRow
                                    label="Save Intermediates"
                                    paramKey="save_mid_res"
                                    value={params.save_mid_res}
                                    onChange={v => setParam('save_mid_res', v)}
                                />
                            </div>
                        )}
                    </div>

                    {/* Advanced / Seed */}
                    <div className="border-b" style={{ borderColor: '#333355' }}>
                        <SectionHeader
                            label="Advanced"
                            open={openSections.advanced}
                            onToggle={() => toggleSection('advanced')}
                        />
                        {openSections.advanced && (
                            <div className="pt-1 px-3 pb-3">
                                <div className="flex items-center justify-between mb-2">
                                    <span
                                        className="text-xs"
                                        style={{ color: '#94a3b8' }}
                                        title={PARAM_DESCRIPTIONS.seed}
                                    >
                                        Seed
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="number"
                                            value={params.seed}
                                            onChange={e =>
                                                setParam('seed', parseInt(e.target.value, 10) || 0)
                                            }
                                            disabled={params.randomize_seed}
                                            className={cn(
                                                'w-16 rounded px-2 py-0.5 text-xs text-white text-center focus:outline-none focus:border-[#7c3aed] disabled:opacity-40',
                                                'border'
                                            )}
                                            style={{ background: '#252542', borderColor: '#333355' }}
                                        />
                                        <button
                                            onClick={() =>
                                                setParam('seed', Math.floor(Math.random() * 2_147_483_647))
                                            }
                                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#333355] transition-colors"
                                            style={{ color: '#64748b' }}
                                            title="Randomize seed"
                                        >
                                            🎲
                                        </button>
                                    </div>
                                </div>
                                <ToggleRow
                                    label="Randomize on Run"
                                    paramKey="seed"
                                    value={params.randomize_seed}
                                    onChange={v => setParam('randomize_seed', v)}
                                />
                            </div>
                        )}
                    </div>
                </>
            </div>

            {/* ── CTA / Progress ───────────────────────────────────────────────────── */}
            <div
                className="flex-shrink-0 p-3 border-t space-y-2.5"
                style={{ borderColor: '#333355' }}
            >
                {/* Error banner */}
                {error && (
                    <div
                        className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
                        style={{
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid #ef4444',
                            color: '#f87171',
                        }}
                    >
                        <span className="flex-shrink-0 mt-0.5">⚠</span>
                        <span>{error}</span>
                    </div>
                )}

                {/* Main Action */}
                <button
                    onClick={isSegmenting ? onCancel : handleStart}
                    disabled={!isEnabled && !isSegmenting}
                    className={cn(
                        "w-full py-3 rounded-xl text-sm font-bold text-[#1a1a2e] transition-opacity hover:opacity-90 btn-gradient",
                        (!isEnabled && !isSegmenting) ? "disabled-btn cursor-not-allowed" : "cursor-pointer shadow-[0_4px_20px_rgba(34,197,94,0.3)]",
                        isSegmenting ? "generating" : ""
                    )}
                >
                    <span className="gradient-bg bg1" aria-hidden />
                    <span className={"gradient-bg bg2" + (isSegmenting ? ' animate' : '')} aria-hidden />


                    <span className="btn-content">
                        {isSegmenting ? (
                            <>
                                <span className="spinner" aria-hidden />
                                <span>Segmenting... {Math.round(progress)}% <span className="text-xs opacity-70 ml-1">(Cancel)</span></span>
                            </>
                        ) : (
                            <span>⚙ Start Segmentation</span>
                        )}
                    </span>
                </button>

                {!isEnabled && !isSegmenting && (
                    <p className="text-center text-[10px]" style={{ color: '#4b5563' }}>
                        Load a 3D model first
                    </p>
                )}
            </div>

            {/* ── Results ──────────────────────────────────────────────────────────── */}
            {
                results.length > 0 && !isSegmenting && (
                    <div
                        className="flex-shrink-0 border-t"
                        style={{ borderColor: '#333355', maxHeight: 200 }}
                    >
                        <div
                            className="px-3 py-2 flex items-center justify-between border-b"
                            style={{ borderColor: '#333355' }}
                        >
                            <span className="text-xs font-semibold" style={{ color: '#94a3b8' }}>
                                {results.length} parts detected
                            </span>
                            <span
                                className="text-[9px] px-1.5 py-0.5 rounded-full"
                                style={{ background: '#22c55e22', color: '#22c55e' }}
                            >
                                ✓ Applied
                            </span>
                        </div>
                        <div className="overflow-y-auto scrollbar-thin" style={{ maxHeight: 148 }}>
                            {results.map(r => (
                                <ResultRow key={r.id} result={r} />
                            ))}
                        </div>
                    </div>
                )
            }

            {/* ── Smart Organize ─────────────────────────────────────────────── */}
            {results.length > 0 && !isSegmenting && onSmartOrganize && (
                <div
                    className="flex-shrink-0 p-3 border-t"
                    style={{ borderColor: '#333355' }}
                >
                    <button
                        onClick={onSmartOrganize}
                        disabled={isOrganizing}
                        className={cn(
                            'w-full py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-90',
                            isOrganizing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                        )}
                        style={{
                            background: isOrganizing
                                ? '#252542'
                                : 'linear-gradient(135deg, #7c3aed, #D5B451)',
                            color: isOrganizing ? '#64748b' : '#fff',
                        }}
                    >
                        {isOrganizing ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Organizing...
                            </span>
                        ) : (
                            'Smart Organize'
                        )}
                    </button>
                    <p
                        className="text-center text-[9px] mt-1.5"
                        style={{ color: '#4b5563' }}
                    >
                        Uses VLM to auto-name parts &amp; create groups
                    </p>
                </div>
            )}
        </div >
    );
}
