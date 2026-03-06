'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo, useReducer, Suspense } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import SegmentAIPanel from '@/components/segment/SegmentAIPanel';
import type { P3SAMParams, SegmentResult } from '@/components/segment/SegmentAIPanel';
import ExportDropdown from '@/components/shared/ExportDropdown';

import type { TransformValues } from '@/components/shared/TransformPanel';
import type { HierarchyItem } from '@/components/shared/HierarchyPanel';
import { findObjectInScene, transformDataToValues } from '@/lib/scene';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useWorkspace } from '@/lib/workspace-context';
import { useSegmentStore } from '@/store/segment-store';

const ThreeViewport = dynamic(() => import('@/components/shared/ThreeViewport'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center bg-[#1a1a2e]">
            <div
                className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: '#f5a623', borderTopColor: 'transparent' }}
            />
        </div>
    ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Part {
    id: string;
    name: string;
    color: string;
    visible: boolean;
    meshIds: string[];     // all mesh IDs belonging to this part
    isGroup?: boolean;     // true = logical group folder
    childIds?: string[];   // if group: contained part IDs
    parentId?: string;     // parent group ID if nested
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEGMENT_PALETTE = [
    '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
    '#f97316', '#a855f7', '#14b8a6', '#eab308',
];

// Realistic P3-SAM part names for the mock result
const MOCK_PART_NAMES = [
    'Body Shell', 'Front Bumper', 'Rear Bumper', 'Hood',
    'Door (L)', 'Door (R)', 'Roof Panel', 'Trunk Lid',
    'Wheel (FL)', 'Wheel (FR)', 'Wheel (RL)', 'Wheel (RR)',
    'Windshield', 'Side Mirror (L)', 'Side Mirror (R)', 'Exhaust',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function buildSegmentColors(parts: Part[]): Record<string, string> {
    const colors: Record<string, string> = {};
    parts.forEach(p => p.meshIds.forEach(mid => { colors[mid] = p.color; }));
    return colors;
}

function buildMeshToPartId(parts: Part[]): Record<string, string> {
    const map: Record<string, string> = {};
    parts.forEach(p => p.meshIds.forEach(mid => { map[mid] = p.id; }));
    return map;
}

function partsToHierarchyItems(parts: Part[]): HierarchyItem[] {
    const topLevel = parts.filter(p => !p.parentId);
    return topLevel.map(p => {
        if (p.isGroup && p.childIds) {
            const children: HierarchyItem[] = p.childIds
                .map(cid => parts.find(c => c.id === cid))
                .filter((c): c is Part => c != null)
                .map(c => ({ id: c.id, name: c.name, visible: c.visible, type: 'mesh' as const }));
            return { id: p.id, name: p.name, visible: p.visible, type: 'group' as const, children };
        }
        const type: HierarchyItem['type'] = p.meshIds.length > 1 ? 'group' : 'mesh';
        return { id: p.id, name: p.name, visible: p.visible, type };
    });
}

// ─── Mock P3-SAM segmentation ─────────────────────────────────────────────────
// Simulates the backend POST /segment/3d call.
// In production this would POST the current GLB and receive a segmented GLB + part labels.

function simulateP3SAMSegmentation(
    params: P3SAMParams,
    availableMeshIds: string[],
    onProgress: (pct: number) => void,
    signal: AbortSignal
): Promise<SegmentResult[]> {
    return new Promise((resolve, reject) => {
        // Estimate runtime based on point density (just for the mock)
        const totalMs = 2000 + (params.point_num / 100000) * 1500;
        const tickMs = 150;
        let elapsed = 0;

        const tick = () => {
            if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            elapsed += tickMs;
            onProgress(Math.min((elapsed / totalMs) * 100, 97));
            if (elapsed < totalMs) {
                setTimeout(tick, tickMs);
            } else {
                // Generate mock results: 4–8 parts depending on threshold
                const partCount = Math.max(4, Math.min(8, Math.round(8 * (1 - params.threshold) + 4)));
                // Distribute available meshes across parts
                const chunkSize = Math.ceil(availableMeshIds.length / partCount);

                const results: SegmentResult[] = Array.from({ length: partCount }, (_, i) => ({
                    id: `ai-part-${i}`,
                    name: MOCK_PART_NAMES[i] ?? `Part ${i + 1}`,
                    color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
                    // Mock IoU score — slightly randomized for realism
                    score: parseFloat((0.75 + Math.random() * 0.22).toFixed(3)),
                    meshIds: availableMeshIds.slice(i * chunkSize, (i + 1) * chunkSize),
                }));

                onProgress(100);
                setTimeout(() => resolve(results), 200);
            }
        };
        setTimeout(tick, tickMs);
    });
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function SegmentPage() {
    const { setSceneGraph, setSegmentHierarchy, assets, activeAssetId, updateAsset } = useWorkspace();
    const activeModelUrl = assets.find(a => a.id === activeAssetId)?.modelUrl ?? null;

    const sceneRef = useRef<THREE.Group | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ── Mesh registry for scene rebuild on undo/redo ──────────────────────────
    // meshRegistryRef: meshId → { obj, origParent } — built at scene-ready time
    const meshRegistryRef = useRef<Map<string, { obj: THREE.Object3D; origParent: THREE.Object3D }>>(new Map());

    // ── Local Imperative Transform History ────────────────────────────────────
    // Because Zundo state rebuilds break Three.js SkinnedMesh parent/child
    // structures, we track transform position/rotation/scale imperatively here.
    const transformHistoryRef = useRef<Record<string, TransformValues>[]>([]);
    const historyIndexRef = useRef<number>(-1);
    const [canUndoTransform, setCanUndoTransform] = useState(false);
    const [canRedoTransform, setCanRedoTransform] = useState(false);

    // ── Parts state — backed by Zundo temporal store ──────────────────────────
    const { parts, setParts } = useSegmentStore();

    // Trigger re-render when temporal store changes (for button disabled state)
    const [, rerender] = useReducer((x: number) => x + 1, 0);

    // Keep a stable ref to rebuildThreeScene so the temporal subscriber (below)
    // can call the latest version without being a stale closure.
    const rebuildRef = useRef<(parts: Part[]) => void>(() => { });

    // Derive colors and meshId map from parts (replaces explicit setState calls)
    const segmentColors = useMemo(() => buildSegmentColors(parts), [parts]);
    const meshToPartId = useMemo(() => buildMeshToPartId(parts), [parts]);

    // AI segmentation state
    const [isSegmenting, setIsSegmenting] = useState(false);
    const [segmentProgress, setSegmentProgress] = useState(0);
    const [segmentError, setSegmentError] = useState<string | null>(null);
    const [aiResults, setAiResults] = useState<SegmentResult[]>([]);

    // ── Selection state ────────────────────────────────────────────────────────
    const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
    const [lastClickedMeshId, setLastClickedMeshId] = useState<string | null>(null);
    const [transform, setTransform] = useState<TransformValues | null>(null);

    const selectedPartId = selectedPartIds[selectedPartIds.length - 1] ?? null;

    const highlightedMeshIds = selectedPartIds.flatMap(pid => {
        const part = parts.find(p => p.id === pid);
        if (!part) return [];
        if (part.isGroup && part.childIds) {
            return part.childIds.flatMap(cid => parts.find(p => p.id === cid)?.meshIds ?? []);
        }
        return part.meshIds;
    });

    // ── Transform History Methods ─────────────────────────────────────────────

    // For capture, we need ALL transformed objects. Not just meshes, but also 
    // any custom Groups we generated in `rebuildThreeScene`!
    // Since TransformControls attaches to whatever `lastClickedMeshId` is (which 
    // could be a custom Group ID), we must capture its transform.
    const captureTransformSnapshot = useCallback((reason = 'unknown') => {
        if (!sceneRef.current) return;
        const snapshot: Record<string, TransformValues> = {};

        // Traverse the entire scene to capture everything's local transform
        sceneRef.current.traverse((obj) => {
            // Only capture objects that we might move (Meshes or our custom Groups)
            if (obj instanceof THREE.Mesh || (obj instanceof THREE.Group && (obj.name.startsWith('merged_') || obj.name.startsWith('group_')))) {
                const key = obj.name || obj.uuid;
                snapshot[key] = {
                    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                };
                if (key === lastClickedMeshId) {
                    console.log(`[UNDO-DEBUG] captureTransformSnapshot saving for ${key}:`, snapshot[key].position);
                }
            }
        });

        if (historyIndexRef.current < transformHistoryRef.current.length - 1) {
            transformHistoryRef.current = transformHistoryRef.current.slice(0, historyIndexRef.current + 1);
        }

        transformHistoryRef.current.push(snapshot);
        historyIndexRef.current = transformHistoryRef.current.length - 1;

        console.log(`[UNDO-DEBUG] captureTransformSnapshot (reason: ${reason}) at index ${historyIndexRef.current}`, Object.keys(snapshot).length, 'objects snapshotted.');

        setCanUndoTransform(historyIndexRef.current > 0);
        setCanRedoTransform(historyIndexRef.current < transformHistoryRef.current.length - 1);
    }, [lastClickedMeshId]);

    const applyTransformSnapshot = useCallback((idx: number) => {
        if (idx < 0 || idx >= transformHistoryRef.current.length || !sceneRef.current) return;
        const snapshot = transformHistoryRef.current[idx];

        let applyCount = 0;
        sceneRef.current.traverse((obj) => {
            const key = obj.name || obj.uuid;
            const tv = snapshot[key];
            if (tv) {
                if (key === lastClickedMeshId) {
                    console.log(`[UNDO-DEBUG] applyTransformSnapshot applying to ${key}: from`,
                        { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                        'to', tv.position
                    );
                }
                obj.position.set(tv.position.x, tv.position.y, tv.position.z);
                obj.rotation.set(tv.rotation.x, tv.rotation.y, tv.rotation.z);
                obj.scale.set(tv.scale.x, tv.scale.y, tv.scale.z);

                // Force comprehensive matrix update for the renderer
                obj.updateMatrixWorld(true);
                applyCount++;

                if (key === lastClickedMeshId) {
                    setTransform(tv);
                    // Crucial: we must notify TransformControls to snap its gizmo 
                    // back to the newly updated object matrix!
                    const customEvent = new CustomEvent('force-transform-update');
                    window.dispatchEvent(customEvent);
                }
            }
        });

        console.log(`[UNDO-DEBUG] applyTransformSnapshot applied index ${idx} to ${applyCount} objects.`);
    }, [lastClickedMeshId]);

    const undoTransform = useCallback(() => {
        if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
            applyTransformSnapshot(historyIndexRef.current);
            setCanUndoTransform(historyIndexRef.current > 0);
            setCanRedoTransform(true);
        }
    }, [applyTransformSnapshot]);

    const redoTransform = useCallback(() => {
        if (historyIndexRef.current < transformHistoryRef.current.length - 1) {
            historyIndexRef.current++;
            applyTransformSnapshot(historyIndexRef.current);
            setCanUndoTransform(true);
            setCanRedoTransform(historyIndexRef.current < transformHistoryRef.current.length - 1);
        }
    }, [applyTransformSnapshot]);

    // ── Scene loading ──────────────────────────────────────────────────────────

    const handleSceneReady = useCallback((group: THREE.Group) => {
        sceneRef.current = group;

        // Build mesh registry AND initial LOCAL transforms before any user operations.
        // We store LOCAL-space transforms (obj.position/rotation/scale) because
        // TransformControls also modifies local-space coords, so undo/redo can
        // directly set them back without any coordinate conversion.
        const registry = new Map<string, { obj: THREE.Object3D; origParent: THREE.Object3D }>();
        group.traverse((child) => {
            if (child instanceof THREE.Mesh && child.parent) {
                const key = child.name || child.uuid;
                registry.set(key, { obj: child, origParent: child.parent });
            }
        });
        meshRegistryRef.current = registry;

        // Reset transform history for the new scene
        transformHistoryRef.current = [];
        historyIndexRef.current = -1;
        setCanUndoTransform(false);
        setCanRedoTransform(false);

        // Capture the baseline snapshot (index 0)
        captureTransformSnapshot('handleSceneReady');
    }, [captureTransformSnapshot]);

    const handleSceneGraphChange = useCallback((nodes: HierarchyItem[]) => {
        const meshes = flattenMeshes(nodes);
        const newParts: Part[] = meshes.map((m, i) => ({
            id: m.id,
            name: m.name,
            color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
            visible: m.visible,
            meshIds: [m.id],
        }));
        // Model load must NOT enter zundo history — pause recording, apply
        // the new parts, resume, then clear so the user can never undo back
        // to a state before the current model was loaded.
        const temporal = useSegmentStore.temporal.getState();
        temporal.pause();
        setParts(newParts);
        temporal.resume();
        temporal.clear();
    }, [setParts]);

    // ── Scene rebuild (called after undo/redo to sync Three.js to parts[]) ────

    const rebuildThreeScene = useCallback((
        targetParts: Part[]
    ) => {
        const scene = sceneRef.current;
        const registry = meshRegistryRef.current;
        if (!scene || registry.size === 0) return;

        // Step 1: Remove all merge/group groups created by our operations
        const toRemove: THREE.Object3D[] = [];
        scene.traverse((child) => {
            if (
                child instanceof THREE.Group &&
                (child.name.startsWith('merged_') || child.name.startsWith('group_'))
            ) {
                toRemove.push(child);
            }
        });
        toRemove.forEach((g) => {
            const children = [...g.children];
            children.forEach((c) => scene.attach(c));
            g.parent?.remove(g);
        });

        // Step 2: Re-parent each mesh to its original parent
        registry.forEach(({ obj, origParent }) => {
            if (obj.parent !== origParent) {
                origParent.attach(obj);
            }
        });

        // Step 3: Re-create Three.js groups from the target parts
        targetParts.forEach((part) => {
            if (part.isGroup && part.childIds && part.childIds.length > 0) {
                const threeGroup = new THREE.Group();
                threeGroup.name = part.id;
                const childMeshIds = part.childIds.flatMap(
                    (cid) => targetParts.find((p) => p.id === cid)?.meshIds ?? []
                );
                const meshObjs = childMeshIds
                    .map((mid) => registry.get(mid)?.obj ?? findObjectInScene(scene, mid))
                    .filter((o): o is THREE.Object3D => o !== null);
                scene.add(threeGroup);
                meshObjs.forEach((obj) => threeGroup.attach(obj));
            } else if (part.meshIds.length > 1) {
                const threeGroup = new THREE.Group();
                threeGroup.name = part.id;
                const meshObjs = part.meshIds
                    .map((mid) => registry.get(mid)?.obj ?? findObjectInScene(scene, mid))
                    .filter((o): o is THREE.Object3D => o !== null);
                scene.add(threeGroup);
                meshObjs.forEach((obj) => threeGroup.attach(obj));
            }
        });

        // Note: WE NO LONGER RESTORE TRANSFORMS HERE.
        // Three.js groups and object transforms naturally persist through 
        // node re-parenting. The custom undo/redo logic (applyTransformSnapshot)
        // handles imperative transform restoration independently of Zundo.

        // Step 4: Restore visibility from the target parts snapshot.
        // zundo restores parts[].visible in React state, but the Three.js
        // .visible flag is imperative and must be synced back explicitly
        // after every undo/redo; otherwise hide/show toggles cannot be undone.
        targetParts.forEach((part) => {
            part.meshIds.forEach((meshId) => {
                const entry = registry.get(meshId);
                if (entry?.obj) entry.obj.visible = part.visible;
            });
        });
    }, []);

    // Keep rebuildRef in sync with the latest stable version of rebuildThreeScene.
    rebuildRef.current = rebuildThreeScene;

    // ── Reactive rebuild: parts changes only (scene STRUCTURE) ────────────────
    // Because Zundo now only stores `parts`, this fires exclusively when
    // groups, merges, or re-arrangements occur. It does not recalculate transforms.
    useEffect(() => {
        if (parts.length === 0) return; // skip until model is loaded
        rebuildThreeScene(parts);
    }, [parts, rebuildThreeScene]);

    // ── Undo/Redo subscriber: rebuild parts on actual undo/redo ────────────────
    // The Zundo temporal subscriber fires on EVERY temporal state change.
    // We rebuild `parts` only when futureStates/pastStates delta indicates an undo/redo.
    useEffect(() => {
        let prevPast = useSegmentStore.temporal.getState().pastStates.length;
        let prevFuture = useSegmentStore.temporal.getState().futureStates.length;

        const unsub = useSegmentStore.temporal.subscribe(() => {
            const { pastStates, futureStates } = useSegmentStore.temporal.getState();
            const curPast = pastStates.length;
            const curFuture = futureStates.length;

            const isUndo = curPast < prevPast;
            const isRedo = curFuture < prevFuture && curPast > prevPast;

            prevPast = curPast;
            prevFuture = curFuture;

            rerender(); // keep undo/redo button disabled-state in sync

            if (!isUndo && !isRedo) return; // ignore snapshot-add and clear

            const { parts: p } = useSegmentStore.getState();
            if (p.length === 0) return;
            rebuildRef.current(p); // rebuild scene structure only
        });
        return unsub;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Selection ──────────────────────────────────────────────────────────────

    const gizmoIdForPart = useCallback((part: Part) => {
        if (part.isGroup || part.meshIds.length > 1) return part.id;
        return part.meshIds[0] ?? part.id;
    }, []);

    const handleObjectSelect = useCallback((meshId: string | null) => {
        if (!meshId) {
            setLastClickedMeshId(null);
            setSelectedPartIds([]);
            setTransform(null);
            return;
        }
        const partId = meshToPartId[meshId] ?? meshId;
        const part = parts.find(p => p.id === partId);
        setLastClickedMeshId(part ? gizmoIdForPart(part) : meshId);
        setSelectedPartIds([partId]);
        // Auto-switch AssetsPanel to Scene tab
        window.dispatchEvent(new CustomEvent('phidias:switch-panel-tab', { detail: 'scene' }));
    }, [meshToPartId, parts, gizmoIdForPart]);

    const handleObjectMultiSelect = useCallback((meshId: string) => {
        const partId = meshToPartId[meshId] ?? meshId;
        const part = parts.find(p => p.id === partId);
        setLastClickedMeshId(part ? gizmoIdForPart(part) : meshId);
        setSelectedPartIds(prev =>
            prev.includes(partId) ? prev.filter(x => x !== partId) : [...prev, partId]
        );
    }, [meshToPartId, parts, gizmoIdForPart]);

    const handlePanelSelect = useCallback((partId: string | null) => {
        if (!partId) {
            setLastClickedMeshId(null);
            setSelectedPartIds([]);
            setTransform(null);
            return;
        }
        const part = parts.find(p => p.id === partId);
        setLastClickedMeshId(part ? gizmoIdForPart(part) : partId);
        setSelectedPartIds([partId]);
    }, [parts, gizmoIdForPart]);

    const handlePanelMultiSelect = useCallback((partId: string) => {
        const part = parts.find(p => p.id === partId);
        setLastClickedMeshId(part ? gizmoIdForPart(part) : partId);
        setSelectedPartIds(prev =>
            prev.includes(partId) ? prev.filter(x => x !== partId) : [...prev, partId]
        );
    }, [parts, gizmoIdForPart]);

    // ── Part operations ────────────────────────────────────────────────────────

    const handleColorChange = useCallback((id: string, color: string) => {
        setParts((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
    }, [setParts]);

    const handleVisibilityToggle = useCallback((id: string, visible: boolean) => {
        setParts((prev) => {
            const newParts = prev.map((p) => (p.id === id ? { ...p, visible } : p));
            const part = newParts.find((p) => p.id === id);
            if (sceneRef.current && part) {
                part.meshIds.forEach((mid) => {
                    const obj = findObjectInScene(sceneRef.current!, mid);
                    if (obj) obj.visible = visible;
                });
            }
            return newParts;
        });
    }, [setParts]);

    const handleMerge = useCallback(() => {
        const selected = parts.filter(p => selectedPartIds.includes(p.id) && !p.isGroup);
        if (selected.length < 2) return;
        const [first, ...rest] = selected;
        const allMeshIds = selected.flatMap(p => p.meshIds);
        const mergedId = `merged_${Date.now()}`;
        const mergedPart: Part = { ...first, id: mergedId, meshIds: allMeshIds };
        const removeIds = new Set(rest.map(p => p.id));
        const newParts = parts
            .map(p => p.id === first.id ? mergedPart : p)
            .filter(p => !removeIds.has(p.id));
        setParts(newParts);
        setSelectedPartIds([mergedId]);
        setLastClickedMeshId(mergedId);
        if (sceneRef.current) {
            const threeGroup = new THREE.Group();
            threeGroup.name = mergedId;
            const meshObjs = allMeshIds
                .map(mid => findObjectInScene(sceneRef.current!, mid))
                .filter((o): o is THREE.Object3D => o !== null);
            sceneRef.current.add(threeGroup);
            meshObjs.forEach(obj => threeGroup.attach(obj));
        }
    }, [parts, selectedPartIds, setParts]);

    const handleGroup = useCallback(() => {
        const selected = parts.filter(p => selectedPartIds.includes(p.id) && !p.parentId);
        if (selected.length < 2) return;
        const groupId = `group_${Date.now()}`;
        const newGroup: Part = {
            id: groupId,
            name: `Group (${selected.length})`,
            color: '#94a3b8',
            visible: true,
            meshIds: [],
            isGroup: true,
            childIds: selected.map(p => p.id),
        };
        const newParts = parts.map(p =>
            selectedPartIds.includes(p.id) ? { ...p, parentId: groupId } : p
        );
        const insertAt = newParts.findIndex(p => p.id === selected[0].id);
        newParts.splice(insertAt, 0, newGroup);
        setParts(newParts);
        setSelectedPartIds([groupId]);
        setLastClickedMeshId(groupId);
        if (sceneRef.current) {
            const threeGroup = new THREE.Group();
            threeGroup.name = groupId;
            const childMeshIds = selected.flatMap(p => p.meshIds);
            const meshObjs = childMeshIds
                .map(mid => findObjectInScene(sceneRef.current!, mid))
                .filter((o): o is THREE.Object3D => o !== null);
            sceneRef.current.add(threeGroup);
            meshObjs.forEach(obj => threeGroup.attach(obj));
        }
    }, [parts, selectedPartIds, setParts]);

    const handleTransformChange = useCallback((tv: TransformValues) => {
        // Update the Transform panel UI only.
        // Do NOT call writeTransformValues here — TransformControls already modified
        // the Three.js object directly. Calling writeTransformValues would fight
        // with TransformControls (each overwriting the other's position), causing
        // the mesh to appear frozen. The old viewer (old_viewer.jsx) never wrote
        // back during drag for the same reason.
        setTransform(tv);
    }, []); // no deps — only updates local UI state

    // Drag start: intentionally a no-op (no pause needed)
    const handleTransformDragStart = useCallback(() => {
        /* no-op — snapshot is committed on drag END only */
    }, []);

    // Drag end: capture the new transform state imperatively.
    const handleTransformDragEnd = useCallback(() => {
        if (!sceneRef.current || !lastClickedMeshId) return;
        const obj = findObjectInScene(sceneRef.current, lastClickedMeshId);
        if (!obj) return;

        // Push new overall snapshot to the imperative history stack
        captureTransformSnapshot('dragEnd');
    }, [lastClickedMeshId, captureTransformSnapshot]);

    const handleRenamePart = useCallback((id: string, name: string) => {
        setParts((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    }, [setParts]);

    // ── Save ─────────────────────────────────────────────────────────────────

    const [isSaving, setIsSaving] = useState(false);

    const handleSave = useCallback(async () => {
        if (!sceneRef.current || !activeAssetId || isSaving) return;
        setIsSaving(true);
        try {
            const exporter = new GLTFExporter();
            const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
                exporter.parse(
                    sceneRef.current!,
                    (result) => resolve(result as ArrayBuffer),
                    (err) => reject(err),
                    { binary: true }
                );
            });
            const blob = new Blob([glb], { type: 'model/gltf-binary' });
            const url = URL.createObjectURL(blob);
            updateAsset(activeAssetId, { modelUrl: url, pipelineUsed: 'segment' });
            // Clear undo/redo history — saved state is the new baseline
            transformHistoryRef.current = [];
            historyIndexRef.current = -1;
            setCanUndoTransform(false);
            setCanRedoTransform(false);
            useSegmentStore.temporal.getState().clear();
        } catch (err) {
            console.error('[Save] GLTFExporter error:', err);
        } finally {
            setIsSaving(false);
        }
    }, [activeAssetId, isSaving, updateAsset]);

    // ── AI Segmentation ────────────────────────────────────────────────────────

    const handleStartSegmentation = useCallback(async (params: P3SAMParams) => {
        setSegmentError(null);
        setIsSegmenting(true);
        setSegmentProgress(0);
        setAiResults([]);

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Gather all mesh IDs from the current scene
        const allMeshIds = parts.flatMap(p => p.meshIds);

        try {
            const results = await simulateP3SAMSegmentation(
                params,
                allMeshIds,
                pct => setSegmentProgress(pct),
                controller.signal
            );

            setAiResults(results);

            // Apply AI results as new parts in the scene
            const newParts: Part[] = results.map(r => ({
                id: r.id,
                name: r.name,
                color: r.color,
                visible: true,
                meshIds: r.meshIds,
            }));
            setParts(newParts);
            setSelectedPartIds([]);
            setLastClickedMeshId(null);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                // user cancelled — reset quietly
                setSegmentProgress(0);
            } else {
                setSegmentError(
                    err instanceof Error ? err.message : 'Segmentation failed. Is the backend running?'
                );
            }
        } finally {
            setIsSegmenting(false);
        }
    }, [parts]);

    const handleCancelSegmentation = useCallback(() => {
        abortRef.current?.abort();
        setIsSegmenting(false);
        setSegmentProgress(0);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => { abortRef.current?.abort(); };
    }, []);

    // ── Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z ─────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl || e.key.toLowerCase() !== 'z') return;
            e.preventDefault();
            if (e.shiftKey) {
                // Redo
                if (canRedoTransform) {
                    redoTransform();
                } else if (useSegmentStore.temporal.getState().futureStates.length > 0) {
                    useSegmentStore.temporal.getState().redo();
                }
            } else {
                // Undo
                if (canUndoTransform) {
                    undoTransform();
                } else if (useSegmentStore.temporal.getState().pastStates.length > 0) {
                    useSegmentStore.temporal.getState().undo();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [canUndoTransform, canRedoTransform, undoTransform, redoTransform]);

    // ── Publish to shared panels ───────────────────────────────────────────────

    useEffect(() => {
        setSceneGraph({
            items: partsToHierarchyItems(parts),
            selectedId: selectedPartId,
            selectedIds: selectedPartIds,
            transform,
            onSelect: handlePanelSelect,
            onMultiSelect: handlePanelMultiSelect,
            onVisibilityToggle: handleVisibilityToggle,
            onTransformChange: handleTransformChange,
        });
    }, [
        parts, selectedPartId, selectedPartIds, transform,
        handlePanelSelect, handlePanelMultiSelect, handleVisibilityToggle, handleTransformChange,
        setSceneGraph,
    ]);
    useEffect(() => () => setSceneGraph(null), [setSceneGraph]);

    useEffect(() => {
        setSegmentHierarchy(partsToHierarchyItems(parts));
    }, [parts, setSegmentHierarchy]);

    const modelLoaded = parts.length > 0;

    return (
        <div className="flex h-full overflow-hidden relative" style={{ background: '#1a1a2e' }}>

            {/* ── Left Panel ────────────────────────────────────────────────────── */}
            <aside
                className="w-[260px] flex-shrink-0 overflow-hidden flex flex-col border-r"
                style={{ background: '#1e1e36', borderColor: '#333355' }}
            >
                {/* Panel content */}
                <div className="flex-1 overflow-hidden">
                    <SegmentAIPanel
                        isEnabled={modelLoaded}
                        isSegmenting={isSegmenting}
                        progress={segmentProgress}
                        error={segmentError}
                        results={aiResults}
                        onStart={handleStartSegmentation}
                        onCancel={handleCancelSegmentation}
                    />
                </div>
            </aside>

            {/* ── Center Viewport ───────────────────────────────────────────────── */}
            <main className="flex-1 relative overflow-hidden">
                <Suspense fallback={null}>
                    <ThreeViewport
                        modelUrl={activeModelUrl ?? ''}
                        showGrid
                        transformMode={lastClickedMeshId ? 'translate' : null}
                        selectedObjectId={lastClickedMeshId ?? undefined}
                        selectedObjectIds={highlightedMeshIds}
                        onObjectSelect={handleObjectSelect}
                        onObjectMultiSelect={handleObjectMultiSelect}
                        onTransformChange={useCallback((t: import('@/lib/api/types').TransformData) => {
                            // Stable callback — new ref only when handleTransformChange changes.
                            // An inline arrow here would cause a new ref on every render,
                            // triggering MainScene's useEffect([selectedObject, onTransformChange])
                            // on every re-render and creating a runaway update loop.
                            handleTransformChange(transformDataToValues(t));
                        }, [handleTransformChange])}
                        onTransformDragStart={handleTransformDragStart}
                        onTransformDragEnd={handleTransformDragEnd}
                        onSceneReady={handleSceneReady}
                        onSceneGraphChange={handleSceneGraphChange}
                        segmentColors={segmentColors}
                        isGenerating={isSegmenting}
                        onHasSkinnedMesh={(v) => { if (activeAssetId) updateAsset(activeAssetId, { hasSkinnedMesh: v }); }}
                        className="w-full h-full"
                    />
                </Suspense>

                {/* AI mode progress overlay on viewport */}
                {isSegmenting && (
                    <div
                        className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 z-10"
                        style={{
                            background: 'rgba(13,13,24,0.92)',
                            border: '1px solid #7c3aed',
                            color: '#a78bfa',
                        }}
                    >
                        <div className="w-3 h-3 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
                        Running P3-SAM segmentation… {Math.round(segmentProgress)}%
                    </div>
                )}

                {/* Bottom Toolbar */}
                <div
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-full z-10"
                    style={{ background: 'rgba(13,13,24,0.95)', border: '1px solid #333355' }}
                >
                    <button
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors ${(useSegmentStore.temporal.getState().pastStates.length > 0 || canUndoTransform)
                            ? 'text-[#94a3b8] hover:text-white hover:bg-[#252542]'
                            : 'text-[#3d3d5c] cursor-not-allowed'
                            }`}
                        title="Undo (CTRL+Z)"
                        onClick={() => {
                            // Prioritize transform undo, fallback to Zundo part undo
                            if (canUndoTransform) {
                                undoTransform();
                            } else if (useSegmentStore.temporal.getState().pastStates.length > 0) {
                                useSegmentStore.temporal.getState().undo();
                            }
                        }}
                        disabled={useSegmentStore.temporal.getState().pastStates.length === 0 && !canUndoTransform}
                    >
                        ↩
                    </button>
                    <button
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors ${(useSegmentStore.temporal.getState().futureStates.length > 0 || canRedoTransform)
                            ? 'text-[#94a3b8] hover:text-white hover:bg-[#252542]'
                            : 'text-[#3d3d5c] cursor-not-allowed'
                            }`}
                        title="Redo (CTRL+SHIFT+Z)"
                        onClick={() => {
                            if (canRedoTransform) {
                                redoTransform();
                            } else if (useSegmentStore.temporal.getState().futureStates.length > 0) {
                                useSegmentStore.temporal.getState().redo();
                            }
                        }}
                        disabled={useSegmentStore.temporal.getState().futureStates.length === 0 && !canRedoTransform}
                    >
                        ↪
                    </button>
                    {/* <button
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-[#94a3b8] hover:text-white hover:bg-[#252542] transition-colors"
                        title="Paint"
                    >
                        🖌
                    </button> */}
                    <div className="h-5 w-px bg-[#333355]" />
                    <button
                        onClick={handleMerge}
                        disabled={
                            selectedPartIds.filter(id => !parts.find(p => p.id === id)?.isGroup).length < 2
                        }
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            selectedPartIds.filter(id => !parts.find(p => p.id === id)?.isGroup).length >= 2
                                ? 'bg-[#7c3aed] text-white hover:bg-[#6d28d9]'
                                : 'bg-[#252542] text-[#64748b] cursor-not-allowed'
                        )}
                    >
                        🔗 Merge{selectedPartIds.length >= 2 ? ` (${selectedPartIds.length})` : ''}
                    </button>
                    <button
                        onClick={handleGroup}
                        disabled={
                            selectedPartIds.filter(id => !parts.find(p => p.id === id)?.parentId).length < 2
                        }
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            selectedPartIds.filter(id => !parts.find(p => p.id === id)?.parentId).length >= 2
                                ? 'bg-[#0E243E] text-white border border-[#D5B451] hover:bg-[#152d4a]'
                                : 'bg-[#252542] text-[#64748b] cursor-not-allowed'
                        )}
                    >
                        📁 Group{selectedPartIds.length >= 2 ? ` (${selectedPartIds.length})` : ''}
                    </button>
                    <div className="h-5 w-px bg-[#333355]" />
                    {/* Quick AI trigger shortcut */}
                    {/* <button
                        onClick={() => setLeftMode(m => m === 'ai' ? 'edit' : 'ai')}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            leftMode === 'ai'
                                ? 'bg-[#D5B451] text-[#0E243E]'
                                : 'bg-[#252542] text-[#94a3b8] hover:text-[#D5B451]'
                        )}
                        title="Toggle AI Segmentation panel"
                    >
                        ⚙ AI
                    </button> */}
                    <div className="h-5 w-px bg-[#333355]" />
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !activeAssetId}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                            isSaving || !activeAssetId
                                ? 'bg-[#16a34a]/50 text-[#1a1a2e]/60 cursor-not-allowed'
                                : 'bg-[#22c55e] text-[#1a1a2e] hover:bg-[#16a34a]'
                        )}
                    >
                        {isSaving ? (
                            <><span className="w-3 h-3 border border-[#1a1a2e] border-t-transparent rounded-full animate-spin" /> Saving…</>
                        ) : 'Save'}
                    </button>
                    {/* <button className="w-8 h-8 rounded-lg flex items-center justify-center text-[#f5a623] hover:bg-[#252542] transition-colors">
            ★
          </button>
          <span className="text-xs text-[#f5a623] font-bold">⚡ 55</span> */}
                    <ExportDropdown />
                </div>
            </main>
        </div>
    );
}
