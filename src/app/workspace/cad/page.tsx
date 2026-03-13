'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import CADHierarchyTree from '@/components/cad/CADHierarchyTree';
import ExportDropdown from '@/components/shared/ExportDropdown';
import type { TransformData } from '@/lib/api/types';
import type { RenderMode } from '@/components/shared/ThreeViewport';
import type { HierarchyItem } from '@/components/shared/HierarchyPanel';
import type { TransformValues } from '@/components/shared/TransformPanel';
import { findObjectInScene, writeTransformValues, transformDataToValues, updateNodeVisibility } from '@/lib/scene';
import { useWorkspace } from '@/lib/workspace-context';
import {
    importStepFile,
    cadResultToGlbUrl,
    detectDuplicates,
    expandHierarchy,
} from '@/lib/occt-bridge';
import type {
    CADImportProgress,
    CADImportResult,
    DuplicateGroup,
} from '@/lib/occt-bridge';

const ThreeViewport = dynamic(() => import('@/components/shared/ThreeViewport'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center bg-[#1a1a2e]">
            <div className="text-center">
                <div
                    className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                    style={{ borderColor: '#f5a623', borderTopColor: 'transparent' }}
                />
                <p className="text-[#64748b] text-xs">Loading viewport...</p>
            </div>
        </div>
    ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENT_PALETTE = [
    '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
    '#f97316', '#a855f7', '#14b8a6', '#eab308',
];

function flattenMeshes(items: HierarchyItem[]): HierarchyItem[] {
    const result: HierarchyItem[] = [];
    function walk(nodes: HierarchyItem[]) {
        for (const n of nodes) {
            if (n.type === 'mesh') result.push(n);
            if (n.children) walk(n.children);
        }
    }
    walk(items);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rename helpers — update name in both scene graph items and Three.js scene
// ─────────────────────────────────────────────────────────────────────────────

function renameInItems(items: HierarchyItem[], id: string, newName: string): HierarchyItem[] {
    return items.map(item => {
        if (item.id === id) return { ...item, name: newName };
        if (item.children) return { ...item, children: renameInItems(item.children, id, newName) };
        return item;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function CADPage() {
    // ── Global asset state (React Context) ────────────────────────────────────
    const { assets, activeAssetId, addAsset, updateAsset, setActiveAssetId, setSceneGraph, updateAssetThumbnail } =
        useWorkspace();
    const activeAsset = assets.find(a => a.id === activeAssetId) ?? null;
    const modelUrl = activeAsset?.modelUrl ?? null;

    // ── Local page state ───────────────────────────────────────────────────────
    const sceneRef = useRef<THREE.Group | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [renderMode, setRenderMode] = useState<RenderMode>('solid');
    const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale' | null>(null);
    const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
    const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
    const [selectedTransform, setSelectedTransform] = useState<TransformValues | null>(null);
    const [sceneGraph, setLocalSceneGraph] = useState<HierarchyItem[]>([]);
    const [showGrid, setShowGrid] = useState(true);
    const [colorViewMode, setColorViewMode] = useState<'original' | 'colored'>('original');

    // ── CAD-specific state ─────────────────────────────────────────────────────
    const [cadProgress, setCadProgress] = useState<CADImportProgress | null>(null);
    const [cadResult, setCadResult] = useState<CADImportResult | null>(null);
    const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
    const [cadSelectedNodeId, setCadSelectedNodeId] = useState<string | null>(null);
    const [highlightedMeshIndices, setHighlightedMeshIndices] = useState<Set<number>>(new Set());

    // Auto-derive segment colors from scene graph meshes
    const segmentColors = useMemo(() => {
        if (colorViewMode === 'original') return undefined;
        const meshes = flattenMeshes(sceneGraph);
        if (meshes.length <= 1) return undefined;
        const colors: Record<string, string> = {};
        meshes.forEach((m, i) => { colors[m.id] = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]; });
        return colors;
    }, [colorViewMode, sceneGraph]);

    const hasMultipleParts = useMemo(() => flattenMeshes(sceneGraph).length > 1, [sceneGraph]);

    // ── Scene graph → workspace context (right panel) ──────────────────────────
    const handleObjectSelectForContext = useCallback((id: string | null) => {
        setSelectedObjectId(id);
        if (id) {
            setSelectedObjectIds([id]);
        } else {
            setSelectedObjectIds([]);
        }
        if (!id) setSelectedTransform(null);
    }, []);

    const handleObjectMultiSelectForContext = useCallback((id: string) => {
        setSelectedObjectIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
        setSelectedObjectId(id);
    }, []);

    const handleVisibilityToggleForContext = useCallback((id: string, visible: boolean) => {
        setLocalSceneGraph(prev => updateNodeVisibility(prev, id, visible));
        if (sceneRef.current) {
            const obj = findObjectInScene(sceneRef.current, id);
            if (obj) obj.visible = visible;
        }
    }, []);

    const handleTransformWriteForContext = useCallback(
        (t: TransformValues) => {
            setSelectedTransform(t);
            if (sceneRef.current && selectedObjectId) {
                const obj = findObjectInScene(sceneRef.current, selectedObjectId);
                if (obj) writeTransformValues(obj, t);
            }
        },
        [selectedObjectId]
    );

    // Rename handler — updates scene graph items and the Three.js object name
    const handleRename = useCallback((id: string, newName: string) => {
        setLocalSceneGraph(prev => renameInItems(prev, id, newName));
        if (sceneRef.current) {
            const obj = findObjectInScene(sceneRef.current, id);
            if (obj) obj.name = newName;
        }
    }, []);

    // Publish scene graph to workspace context so the right-side AssetsPanel can show it
    useEffect(() => {
        setSceneGraph({
            items: sceneGraph,
            selectedId: selectedObjectId,
            selectedIds: selectedObjectIds,
            transform: selectedTransform,
            onSelect: handleObjectSelectForContext,
            onMultiSelect: handleObjectMultiSelectForContext,
            onVisibilityToggle: handleVisibilityToggleForContext,
            onTransformChange: handleTransformWriteForContext,
            onRename: handleRename,
        });
    }, [sceneGraph, selectedObjectId, selectedObjectIds, selectedTransform,
        handleObjectSelectForContext, handleObjectMultiSelectForContext,
        handleVisibilityToggleForContext, handleTransformWriteForContext,
        handleRename, setSceneGraph]);

    // Clean up scene graph on unmount
    useEffect(() => () => setSceneGraph(null), [setSceneGraph]);

    // Reset viewport state when active asset changes
    useEffect(() => {
        setSelectedObjectId(null);
        setSelectedObjectIds([]);
        setSelectedTransform(null);
        setLocalSceneGraph([]);
        setColorViewMode('original');
        sceneRef.current = null;
    }, [activeAssetId]);

    // ── CAD File Import ────────────────────────────────────────────────────────
    const handleFileImport = useCallback(async (file: File) => {
        setIsLoading(true);
        setCadProgress({ stage: 'Reading file...', percent: 0 });
        setCadSelectedNodeId(null);
        setHighlightedMeshIndices(new Set());

        try {
            const rawResult = await importStepFile(file, setCadProgress);
            const result = expandHierarchy(rawResult);

            setCadResult(result);
            setDuplicates(detectDuplicates(result.meshes));

            setCadProgress({ stage: 'Converting to GLB...', percent: 90 });
            const glbUrl = await cadResultToGlbUrl(result);

            const assetId = addAsset({
                name: file.name.replace(/\.[^.]+$/, '') || 'CAD Import',
                modelUrl: glbUrl,
                type: 'untextured',
                status: 'ready',
                pipelineUsed: 'uploaded',
                fileSize: file.size,
            });
            setActiveAssetId(assetId);
        } catch (err: unknown) {
            console.error('CAD import failed:', err);
        } finally {
            setIsLoading(false);
            setCadProgress(null);
        }
    }, [addAsset, setActiveAssetId]);

    // Listen for file uploads from AssetsPanel (right side)
    useEffect(() => {
        const handler = (e: Event) => {
            const file = (e as CustomEvent<File>).detail;
            if (file) handleFileImport(file);
        };
        window.addEventListener('phidias:cad-file-upload', handler);
        return () => window.removeEventListener('phidias:cad-file-upload', handler);
    }, [handleFileImport]);

    // ── CAD hierarchy tree callbacks ───────────────────────────────────────────
    const handleCadNodeSelect = useCallback((nodeId: string, meshIndices: number[]) => {
        setCadSelectedNodeId(nodeId);
        setHighlightedMeshIndices(new Set(meshIndices));
        if (meshIndices.length === 1 && sceneRef.current) {
            let meshIdx = 0;
            sceneRef.current.traverse((obj) => {
                if ((obj as THREE.Mesh).isMesh) {
                    if (meshIndices.includes(meshIdx)) {
                        handleObjectSelectForContext(obj.name || obj.uuid);
                    }
                    meshIdx++;
                }
            });
        }
    }, [handleObjectSelectForContext]);

    const handleCadNodeVisibilityToggle = useCallback((_nodeId: string, visible: boolean) => {
        if (sceneRef.current) {
            sceneRef.current.traverse((obj) => {
                if (obj.name && _nodeId.includes(obj.name)) {
                    obj.visible = visible;
                }
            });
        }
    }, []);

    const handleDeleteDuplicates = useCallback((group: DuplicateGroup) => {
        if (!sceneRef.current) return;
        const indicesToHide = group.meshIndices.slice(1);
        let meshIndex = 0;
        sceneRef.current.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
                if (indicesToHide.includes(meshIndex)) {
                    obj.visible = false;
                }
                meshIndex++;
            }
        });
        setDuplicates(prev => prev.filter(g => g.hash !== group.hash));
    }, []);

    // ── Viewport callbacks ─────────────────────────────────────────────────────
    const handleSceneReady = useCallback((group: THREE.Group) => { sceneRef.current = group; }, []);
    const handleSceneGraphChange = useCallback((nodes: HierarchyItem[]) => setLocalSceneGraph(nodes), []);
    const handleObjectSelect = useCallback((id: string | null) => {
        setSelectedObjectId(id);
        if (id) setSelectedObjectIds([id]); else setSelectedObjectIds([]);
        if (!id) setSelectedTransform(null);
    }, []);
    const handleObjectMultiSelect = useCallback((id: string) => {
        setSelectedObjectIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
        setSelectedObjectId(id);
    }, []);
    const handleTransformChange = useCallback((t: TransformData) => setSelectedTransform(transformDataToValues(t)), []);
    const handleThumbnailReady = useCallback(
        (dataUrl: string) => { if (activeAssetId) updateAssetThumbnail(activeAssetId, dataUrl); },
        [activeAssetId, updateAssetThumbnail]
    );
    const handleHasSkinnedMesh = useCallback(
        (value: boolean) => { if (activeAssetId) updateAsset(activeAssetId, { hasSkinnedMesh: value }); },
        [activeAssetId, updateAsset]
    );

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="flex h-full overflow-hidden" style={{ background: '#1a1a2e' }}>
            {/* Left panel — CAD Hierarchy + Duplicates */}
            {cadResult && (
                <aside
                    className="w-[260px] flex-shrink-0 overflow-hidden flex flex-col border-r"
                    style={{ background: '#1e1e36', borderColor: '#333355' }}
                >
                    {/* Progress bar during import */}
                    {isLoading && cadProgress && (
                        <div className="px-3 py-2 border-b border-[#333355]">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-[#94a3b8]">{cadProgress.stage}</span>
                                <span className="text-[10px] text-[#D5B451] font-mono">{cadProgress.percent}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#1a1a2e] overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                        width: `${cadProgress.percent}%`,
                                        background: 'linear-gradient(90deg, #D5B451, #f5a623)',
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <CADHierarchyTree
                        root={cadResult.root}
                        duplicates={duplicates}
                        selectedNodeId={cadSelectedNodeId}
                        highlightedMeshIndices={highlightedMeshIndices}
                        onNodeSelect={handleCadNodeSelect}
                        onNodeVisibilityToggle={handleCadNodeVisibilityToggle}
                        onDeleteDuplicates={handleDeleteDuplicates}
                    />
                </aside>
            )}

            {/* Viewport */}
            <main className="flex-1 relative overflow-hidden flex flex-col">
                <div className="flex-1 relative">
                    {(modelUrl || isLoading) ? (
                        <Suspense fallback={null}>
                            <ThreeViewport
                                modelUrl={modelUrl ?? undefined}
                                showGrid={showGrid}
                                renderMode={renderMode}
                                transformMode={transformMode}
                                selectedObjectId={selectedObjectId}
                                selectedObjectIds={selectedObjectIds}
                                onObjectSelect={handleObjectSelect}
                                onObjectMultiSelect={handleObjectMultiSelect}
                                onTransformChange={handleTransformChange}
                                onSceneReady={handleSceneReady}
                                onSceneGraphChange={handleSceneGraphChange}
                                showStats={!!modelUrl}
                                isGenerating={isLoading}
                                generatingLabel="Importing CAD"
                                onThumbnailReady={handleThumbnailReady}
                                onHasSkinnedMesh={handleHasSkinnedMesh}
                                segmentColors={segmentColors}
                                colorViewMode={hasMultipleParts ? colorViewMode : undefined}
                                onColorViewModeChange={hasMultipleParts ? setColorViewMode : undefined}
                                className="w-full h-full"
                            />
                        </Suspense>
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: '#1a1a2e' }}>
                            <div className="text-6xl mb-4 opacity-20">&#9881;</div>
                            <p className="text-[#64748b] text-sm">CAD model will appear here</p>
                            <p className="text-[#4b5563] text-xs mt-1">Upload a .STP / .STEP file from the Assets panel on the right</p>
                        </div>
                    )}
                </div>

                {/* Bottom toolbar */}
                <div
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-full z-10"
                    style={{ background: 'rgba(13,13,24,0.95)', border: '1px solid #333355' }}
                >
                    <ExportDropdown sceneRef={sceneRef} />
                </div>
            </main>
        </div>
    );
}
