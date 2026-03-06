'use client';

/**
 * ThreeViewport — Shared Three.js canvas wrapper for all Phidias 3D tabs.
 *
 * Uses React Three Fiber + Drei for declarative scene composition.
 * Supports: GLB loading, PLY point clouds, orbit/transform/first-person controls,
 * render modes (solid/wireframe/textured/matcap), selection glow, segment colors,
 * split-view comparison, stats overlay, HDR environment, and a view-cube gizmo.
 */

import React, {
    useRef,
    useState,
    useEffect,
    useMemo,
    useCallback,
    Suspense,
    Component,
} from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import {
    OrbitControls,
    TransformControls,
    Grid,
    Environment,
    useGLTF,
    PerspectiveCamera,
    GizmoHelper,
    GizmoViewport,
    PointerLockControls,
} from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { EffectComposer, Outline, Selection, Select } from '@react-three/postprocessing';
import type { OutlineEffect } from 'postprocessing';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TransformData } from '@/lib/api/types';
import SciFiLoader from './SciFiLoader';
import { parseSceneGraph, objectId, findObjectInScene } from '@/lib/scene';
import type { HierarchyItem } from '@/components/shared/HierarchyPanel';

// Preload the primary sample asset so the first viewport renders quickly
useGLTF.preload('/samples/sky_car_sam3d_parts.glb');

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RenderMode = 'solid' | 'wireframe' | 'textured' | 'matcap';

export interface ThreeViewportProps {
    /** URL to load as a GLB/GLTF model */
    modelUrl?: string;
    /** URL to load as a PLY point cloud */
    pointCloudUrl?: string;
    /** Show the infinite grid helper */
    showGrid?: boolean;
    /** Show the view-cube axis gizmo in the corner */
    showAxes?: boolean;
    /** Active transform gizmo mode; null = no gizmo */
    transformMode?: 'translate' | 'rotate' | 'scale' | null;
    /** How to render the model's surfaces */
    renderMode?: RenderMode;
    /** Object name/id to highlight with selection glow */
    selectedObjectId?: string | null;
    /** Additional object ids to highlight (multi-select) */
    selectedObjectIds?: string[];
    /** Called when the user clicks an object in the viewport */
    onObjectSelect?: (id: string | null) => void;
    /** Called on Ctrl/Cmd+click — parent handles add/remove from multi-selection */
    onObjectMultiSelect?: (id: string) => void;
    /** Called whenever the transform gizmo changes the selected object */
    onTransformChange?: (transform: TransformData) => void;
    /** Called when the user starts dragging the transform gizmo */
    onTransformDragStart?: () => void;
    /** Called when the user releases the transform gizmo */
    onTransformDragEnd?: () => void;
    /** Show face/vertex stats in the top-right corner */
    showStats?: boolean;
    /** Enable PointerLock first-person WASD walkthrough */
    enableFirstPerson?: boolean;
    /** Render two viewports side-by-side for before/after comparison */
    splitView?: boolean;
    leftContent?: 'original' | 'wireframe';
    rightContent?: 'retopo' | 'wireframe';
    /** Map from mesh name → hex color for per-part segment coloring */
    segmentColors?: Record<string, string>;
    /** Custom HDR environment map URL (must be in /public) */
    hdrUrl?: string;
    /** Additional Three.js objects to render inside the scene */
    children?: React.ReactNode;
    /** Show SciFi particle loader inside the viewport during AI generation */
    isGenerating?: boolean;
    /** Called with the Three.js Group when a GLB model is first loaded */
    onSceneReady?: (group: THREE.Group) => void;
    /** Called with parsed HierarchyItem tree when a model loads */
    onSceneGraphChange?: (nodes: HierarchyItem[]) => void;
    /** CSS class applied to the outer container div */
    className?: string;
    /** Stats to display (used by parent for pre-computed values) */
    statsData?: { faces: number; vertices: number; topology: string };
    /** Called with a JPEG data-URL after the model first renders — use for asset thumbnails */
    onThumbnailReady?: (dataUrl: string) => void;
    /** Called after the model loads, true if any SkinnedMesh was found */
    onHasSkinnedMesh?: (value: boolean) => void;
}

// ─── Error Boundary ────────────────────────────────────────────────────────────

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

class ViewportErrorBoundary extends Component<
    { children: React.ReactNode },
    ErrorBoundaryState
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    className="flex flex-col items-center justify-center w-full h-full"
                    style={{ background: '#1a1a2e', color: '#94a3b8' }}
                >
                    <div className="text-4xl mb-4">⚠</div>
                    <p className="text-sm font-mono">3D viewport error</p>
                    <p className="text-xs mt-1 opacity-60">
                        {this.state.error?.message ?? 'Unknown error'}
                    </p>
                </div>
            );
        }
        return this.props.children;
    }
}

// ─── Loading Fallback ─────────────────────────────────────────────────────────

function ViewportLoadingFallback() {
    return (
        <div
            className="flex flex-col items-center justify-center w-full h-full"
            style={{ background: '#1a1a2e' }}
        >
            <div
                className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: '#f5a623', borderTopColor: 'transparent' }}
            />
            <p className="text-xs mt-3" style={{ color: '#64748b' }}>
                Loading 3D scene…
            </p>
        </div>
    );
}

// ─── GLB Model ────────────────────────────────────────────────────────────────

interface GLBModelProps {
    url: string;
    segmentColors?: Record<string, string>;
    renderMode?: RenderMode;
    selected?: boolean;
    onSelect?: (name: string) => void;
    onMultiSelect?: (name: string) => void;
    highlightedMeshName?: string | null;
    selectedObjectIds?: string[];
    onSceneReady?: (group: THREE.Group) => void;
    onSceneGraphChange?: (nodes: HierarchyItem[]) => void;
    /** Ref to the OutlineEffect — used to directly set segment-mode selection */
    outlineRef?: React.RefObject<OutlineEffect | null>;
    /** Called once when the scene is parsed — true if any SkinnedMesh found */
    onHasSkinnedMesh?: (value: boolean) => void;
}

function GLBModel({
    url,
    segmentColors,
    renderMode = 'textured',
    selected = false,
    onSelect,
    onMultiSelect,
    highlightedMeshName,
    selectedObjectIds,
    onSceneReady,
    onSceneGraphChange,
    outlineRef,
    onHasSkinnedMesh,
}: GLBModelProps) {
    const { scene } = useGLTF(url);
    // Use SkeletonUtils.clone instead of scene.clone(true) so that SkinnedMesh
    // skeletons are properly rebound in the cloned scene. With scene.clone(true),
    // cloned SkinnedMeshes still reference the original skeleton's bone matrices,
    // causing the WebGL skinning shader to override any position changes — the
    // mesh appears frozen even when its local transform is moved.
    const clonedScene = useMemo(() => cloneWithSkeleton(scene) as THREE.Group, [scene]);
    const groupRef = useRef<THREE.Group>(null);
    const { invalidate } = useThree();

    const callbacks = useRef({ onSceneReady, onSceneGraphChange, onHasSkinnedMesh });
    callbacks.current = { onSceneReady, onSceneGraphChange, onHasSkinnedMesh };

    // Notify parent when scene is ready for export/inspection.
    // Pass clonedScene (not groupRef) so that any objects added via onSceneReady
    // stay inside the <primitive> subtree — required for R3F click events and traversal.
    useEffect(() => {
        callbacks.current.onSceneReady?.(clonedScene);
        if (callbacks.current.onSceneGraphChange) {
            callbacks.current.onSceneGraphChange(parseSceneGraph(clonedScene));
        }
        // Detect SkinnedMesh in the loaded scene
        if (callbacks.current.onHasSkinnedMesh) {
            let found = false;
            clonedScene.traverse((child) => {
                if (!found && child instanceof THREE.SkinnedMesh) found = true;
            });
            callbacks.current.onHasSkinnedMesh(found);
        }
    }, [clonedScene]);

    // Segment mode = caller passes selectedObjectIds (even if empty).
    // Model mode  = selectedObjectIds is undefined.
    const isSegmentMode = selectedObjectIds !== undefined;

    // Segment mode: directly set the OutlineEffect selection so individual
    // highlighted meshes get the orange outline (bypasses React Selection context).
    useEffect(() => {
        if (!isSegmentMode || !outlineRef?.current) return;

        const effect = outlineRef.current;
        const highlighted: THREE.Mesh[] = [];
        clonedScene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const oid = objectId(child);
            const isHighlighted =
                (highlightedMeshName != null && oid === highlightedMeshName) ||
                (selectedObjectIds != null && selectedObjectIds.includes(oid));
            if (isHighlighted) highlighted.push(child);
        });

        effect.selection.set(highlighted);
        invalidate();

        return () => {
            effect.selection.clear();
            invalidate();
        };
    }, [clonedScene, selectedObjectIds, highlightedMeshName, isSegmentMode, outlineRef, invalidate]);

    // Apply render mode, segment colors, and emissive highlight (model mode only).
    useEffect(() => {
        const isHighlighted = (child: THREE.Mesh) => {
            const oid = objectId(child);
            return (highlightedMeshName != null && oid === highlightedMeshName) ||
                (selectedObjectIds != null && selectedObjectIds.includes(oid));
        };

        clonedScene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;

            // Segment color override (flat material — Outline handles selection highlight)
            const segColor = segmentColors && (segmentColors[objectId(child)] ?? segmentColors[child.name]);
            if (segColor) {
                child.material = new THREE.MeshStandardMaterial({
                    color: segColor,
                    roughness: 0.6,
                    metalness: 0.1,
                });
                return;
            }

            // ── Model mode render modes (with emissive highlight) ──────────────────
            const baseMat = Array.isArray(child.material) ? child.material[0] : child.material;

            switch (renderMode) {
                case 'wireframe': {
                    child.material = new THREE.MeshBasicMaterial({ color: '#4a90d9', wireframe: true });
                    break;
                }
                case 'solid': {
                    child.material = new THREE.MeshStandardMaterial({
                        color: isHighlighted(child) ? '#6366f1' : '#8899bb',
                        roughness: 0.7,
                        metalness: 0.1,
                        emissive: isHighlighted(child) ? new THREE.Color('#6366f1') : new THREE.Color(0),
                        emissiveIntensity: isHighlighted(child) ? 0.35 : 0,
                    });
                    break;
                }
                case 'matcap': {
                    child.material = new THREE.MeshMatcapMaterial({ color: '#cccccc' });
                    break;
                }
                case 'textured':
                default: {
                    if (baseMat && baseMat instanceof THREE.MeshStandardMaterial) {
                        baseMat.wireframe = false;
                        if (isHighlighted(child)) {
                            baseMat.emissive = new THREE.Color('#6366f1');
                            baseMat.emissiveIntensity = 0.35;
                        } else {
                            baseMat.emissive = new THREE.Color(0);
                            baseMat.emissiveIntensity = 0;
                        }
                    }
                    break;
                }
            }
        });
    }, [clonedScene, segmentColors, renderMode, highlightedMeshName, selectedObjectIds]);

    const handleClick = useCallback(
        (e: { stopPropagation: () => void; object: THREE.Object3D; nativeEvent: MouseEvent }) => {
            e.stopPropagation();
            const id = objectId(e.object);
            if ((e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) && onMultiSelect) {
                onMultiSelect(id);
            } else {
                onSelect?.(id);
            }
        },
        [onSelect, onMultiSelect]
    );

    const primitiveEl = (
        <primitive
            object={clonedScene}
            onClick={handleClick}
        />
    );

    return (
        <group ref={groupRef}>
            {isSegmentMode ? (
                // Segment mode: individual mesh layers managed in useEffect above;
                // no <Select> wrapper so the whole-model outline doesn't fire.
                primitiveEl
            ) : (
                // Model mode: <Select> puts the whole model on the outline layer
                // whenever something is selected.
                <Select enabled={selected}>{primitiveEl}</Select>
            )}
        </group>
    );
}

// ─── PLY Point Cloud ──────────────────────────────────────────────────────────

function PLYPointCloud({ url }: { url: string }) {
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const loader = new PLYLoader();
        loader.load(
            url,
            (geo) => {
                if (cancelled) return;
                geo.computeVertexNormals();
                geo.center();
                setGeometry(geo);
            },
            undefined,
            (err) => {
                if (!cancelled) setError(String(err));
            }
        );
        return () => {
            cancelled = true;
        };
    }, [url]);

    if (error) {
        console.error('[PLYPointCloud] Load error:', error);
        return null;
    }
    if (!geometry) return null;

    return (
        <points geometry={geometry}>
            <pointsMaterial
                size={0.008}
                vertexColors
                sizeAttenuation
                transparent
                opacity={0.9}
            />
        </points>
    );
}

// ─── Scene Lighting ───────────────────────────────────────────────────────────

function SceneLighting({ hdrUrl }: { hdrUrl?: string }) {
    return (
        <>
            <ambientLight intensity={0.4} />
            <directionalLight
                position={[5, 10, 5]}
                intensity={1.0}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
            />
            <directionalLight position={[-5, 5, -5]} intensity={0.3} />
            {hdrUrl ? (
                <Environment files={hdrUrl} background={false} />
            ) : (
                <Environment preset="city" background={false} />
            )}
        </>
    );
}

// ─── First Person Controller ──────────────────────────────────────────────────

function FirstPersonController({
    onExit,
}: {
    onExit: () => void;
}) {
    const { camera } = useThree();
    const lockRef = useRef<{ lock: () => void; unlock: () => void } | null>(null);
    const keysRef = useRef<Set<string>>(new Set());
    const moveSpeed = 5; // units per second

    useEffect(() => {
        // Set camera to eye height (1.7 m)
        camera.position.y = 1.7;

        const handleKeyDown = (e: KeyboardEvent) => {
            keysRef.current.add(e.code);
            if (e.code === 'Escape') {
                onExit();
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            keysRef.current.delete(e.code);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [camera, onExit]);

    useFrame((_, delta) => {
        if (!keysRef.current.size) return;

        const direction = new THREE.Vector3();
        const frontVec = new THREE.Vector3();
        const sideVec = new THREE.Vector3();

        camera.getWorldDirection(frontVec);
        frontVec.y = 0;
        frontVec.normalize();

        sideVec.crossVectors(frontVec, new THREE.Vector3(0, 1, 0));

        if (keysRef.current.has('KeyW') || keysRef.current.has('ArrowUp')) {
            direction.add(frontVec);
        }
        if (keysRef.current.has('KeyS') || keysRef.current.has('ArrowDown')) {
            direction.sub(frontVec);
        }
        if (keysRef.current.has('KeyA') || keysRef.current.has('ArrowLeft')) {
            direction.sub(sideVec);
        }
        if (keysRef.current.has('KeyD') || keysRef.current.has('ArrowRight')) {
            direction.add(sideVec);
        }

        if (direction.lengthSq() > 0) {
            direction.normalize();
            camera.position.addScaledVector(direction, moveSpeed * delta);
            // Keep eye height constant
            camera.position.y = 1.7;
        }
    });

    return (
        <PointerLockControls
            ref={(ref) => {
                if (ref) {
                    lockRef.current = ref as unknown as {
                        lock: () => void;
                        unlock: () => void;
                    };
                }
            }}
            onUnlock={onExit}
        />
    );
}

// ─── Scene Stats Sync ─────────────────────────────────────────────────────────

/**
 * Reads the scene graph every time the modelUrl changes and
 * reports face/vertex counts via a callback.
 */
interface StatsCollectorProps {
    modelUrl?: string;
    onStats: (stats: { faces: number; vertices: number }) => void;
}

function StatsCollector({ modelUrl, onStats }: StatsCollectorProps) {
    const { scene } = useThree();

    useEffect(() => {
        if (!modelUrl) return;

        // Wait one frame for the primitive to mount
        const id = requestAnimationFrame(() => {
            let faces = 0;
            let vertices = 0;
            scene.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const geo = child.geometry as THREE.BufferGeometry;
                const pos = geo.attributes['position'];
                if (!pos) return;
                vertices += pos.count;
                if (geo.index) {
                    faces += geo.index.count / 3;
                } else {
                    faces += pos.count / 3;
                }
            });
            onStats({ faces: Math.round(faces), vertices });
        });

        return () => cancelAnimationFrame(id);
    }, [modelUrl, scene, onStats]);

    return null;
}

// ─── Thumbnail Capture ────────────────────────────────────────────────────────

/**
 * After the model URL changes, waits 600 ms for the scene to settle then
 * captures the WebGL canvas as a JPEG data-URL and fires onCapture.
 * Requires preserveDrawingBuffer: true on the parent Canvas.
 */
function ThumbnailCapture({
    modelUrl,
    onCapture,
}: {
    modelUrl?: string;
    onCapture: (dataUrl: string) => void;
}) {
    const { gl } = useThree();
    const callbackRef = useRef(onCapture);
    callbackRef.current = onCapture;

    useEffect(() => {
        if (!modelUrl) return;
        const id = setTimeout(() => {
            const dataUrl = gl.domElement.toDataURL('image/jpeg', 0.82);
            callbackRef.current(dataUrl);
        }, 650);
        return () => clearTimeout(id);
    }, [modelUrl, gl]);

    return null;
}

// ─── Main Scene ───────────────────────────────────────────────────────────────

interface MainSceneProps
    extends Omit<
        ThreeViewportProps,
        'className' | 'showStats' | 'statsData' | 'splitView' | 'leftContent' | 'rightContent'
    > {
    onSceneStats?: (stats: { faces: number; vertices: number }) => void;
    isFirstPerson?: boolean;
    onExitFirstPerson?: () => void;
}

function MainScene({
    modelUrl,
    pointCloudUrl,
    showGrid = true,
    showAxes = true,
    transformMode = null,
    renderMode = 'textured',
    selectedObjectId,
    onObjectSelect,
    onTransformChange,
    onTransformDragStart,
    onTransformDragEnd,
    enableFirstPerson: _enableFirstPerson = false,
    segmentColors,
    hdrUrl,
    children,
    onSceneStats,
    isFirstPerson = false,
    onExitFirstPerson,
    isGenerating = false,
    onSceneReady,
    onSceneGraphChange,
    selectedObjectIds,
    onObjectMultiSelect,
    onThumbnailReady,
    onHasSkinnedMesh: onHasSkinnedMeshProp,
}: MainSceneProps) {
    const modelGroupRef = useRef<THREE.Group>(null);
    const [selectedObject, setSelectedObject] = useState<THREE.Object3D | null>(null);
    const orbitRef = useRef<OrbitControlsImpl>(null);
    const outlineRef = useRef<OutlineEffect>(null);
    // Only disable orbit while the gizmo handle is being actively dragged
    const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);
    const [transformKey, setTransformKey] = useState(0);

    // Sync selectedObject whenever selectedObjectId prop changes (handles programmatic
    // selection from parent, e.g. after Merge/Group operations).
    useEffect(() => {
        if (!selectedObjectId) {
            setSelectedObject(null);
            return;
        }
        if (modelGroupRef.current) {
            const found = findObjectInScene(modelGroupRef.current, selectedObjectId);
            setSelectedObject(found);
        }
    }, [selectedObjectId]);

    // Force TransformControls to snap to new transforms (Undo/Redo)
    useEffect(() => {
        const handler = () => setTransformKey(k => k + 1);
        window.addEventListener('force-transform-update', handler);
        return () => window.removeEventListener('force-transform-update', handler);
    }, []);

    // Fire transform once whenever selection changes (avoids per-frame polling)
    useEffect(() => {
        if (selectedObject && onTransformChange) {
            onTransformChange({
                position: [selectedObject.position.x, selectedObject.position.y, selectedObject.position.z],
                rotation: [selectedObject.rotation.x, selectedObject.rotation.y, selectedObject.rotation.z],
                scale: [selectedObject.scale.x, selectedObject.scale.y, selectedObject.scale.z],
            });
        }
    }, [selectedObject, onTransformChange]);

    const handleObjectSelect = useCallback(
        (name: string | null) => {
            onObjectSelect?.(name);
            if (!name) {
                setSelectedObject(null);
                return;
            }
            if (modelGroupRef.current) {
                const found = findObjectInScene(modelGroupRef.current, name);
                setSelectedObject(found);
            }
        },
        [onObjectSelect]
    );

    const isSelected = Boolean(selectedObjectId);

    return (
        <>
            <PerspectiveCamera makeDefault fov={45} near={0.1} far={1000} position={[0, 2, 5]} />
            <SceneLighting hdrUrl={hdrUrl} />

            {/* Grid */}
            {showGrid && (
                <Grid
                    args={[20, 20]}
                    cellColor="#333355"
                    sectionColor="#444466"
                    sectionSize={5}
                    cellSize={1}
                    fadeDistance={30}
                    infiniteGrid
                    position={[0, -0.01, 0]}
                />
            )}

            {/* GLB Model */}
            {modelUrl && (
                <group ref={modelGroupRef}>
                    <Selection>
                        <EffectComposer autoClear={false}>
                            <Outline
                                ref={outlineRef}
                                visibleEdgeColor={0xf5a623}
                                hiddenEdgeColor={0xf5a623}
                                edgeStrength={3}
                                blur
                                selectionLayer={10}
                            />
                        </EffectComposer>
                        <GLBModel
                            url={modelUrl}
                            segmentColors={segmentColors}
                            renderMode={renderMode}
                            selected={isSelected}
                            onSelect={handleObjectSelect}
                            onMultiSelect={onObjectMultiSelect}
                            highlightedMeshName={selectedObjectId}
                            selectedObjectIds={selectedObjectIds}
                            onSceneReady={onSceneReady}
                            onSceneGraphChange={onSceneGraphChange}
                            outlineRef={outlineRef}
                            onHasSkinnedMesh={onHasSkinnedMeshProp}
                        />
                    </Selection>
                </group>
            )}

            {/* PLY Point Cloud */}
            {pointCloudUrl && (
                <Suspense fallback={null}>
                    <PLYPointCloud url={pointCloudUrl} />
                </Suspense>
            )}

            {/* TransformControls — attached to the selected object only.
          Orbit is disabled only while a gizmo handle is actively dragged. */}
            {transformMode && selectedObject && (
                <TransformControls
                    key={`transform-${transformKey}`}
                    object={selectedObject}
                    mode={transformMode}
                    onMouseDown={() => { setIsDraggingGizmo(true); onTransformDragStart?.(); }}
                    onMouseUp={() => { setIsDraggingGizmo(false); onTransformDragEnd?.(); }}
                    onObjectChange={() => {
                        if (selectedObject && onTransformChange) {
                            onTransformChange({
                                position: [selectedObject.position.x, selectedObject.position.y, selectedObject.position.z],
                                rotation: [selectedObject.rotation.x, selectedObject.rotation.y, selectedObject.rotation.z],
                                scale: [selectedObject.scale.x, selectedObject.scale.y, selectedObject.scale.z],
                            });
                        }
                    }}
                />
            )}

            {/* Stats collector */}
            {onSceneStats && (
                <StatsCollector modelUrl={modelUrl} onStats={onSceneStats} />
            )}

            {/* Thumbnail capture — fires once after model settles */}
            {onThumbnailReady && (
                <ThumbnailCapture modelUrl={modelUrl} onCapture={onThumbnailReady} />
            )}

            {/* Controls: First Person vs Orbit */}
            {isFirstPerson ? (
                <FirstPersonController onExit={onExitFirstPerson ?? (() => { })} />
            ) : (
                <OrbitControls
                    ref={orbitRef}
                    enableDamping
                    dampingFactor={0.05}
                    enabled={!isDraggingGizmo}
                    makeDefault
                />
            )}

            {/* View Cube Gizmo */}
            {showAxes && (
                <GizmoHelper alignment="top-right" margin={[80, 80]}>
                    <GizmoViewport
                        axisColors={['#ef4444', '#22c55e', '#3b82f6']}
                        labelColor="white"
                        axisHeadScale={1}
                    />
                </GizmoHelper>
            )}

            {/* SciFi Loader — shown during AI generation */}
            {isGenerating && <SciFiLoader />}

            {/* Extra scene children from parent */}
            {children}
        </>
    );
}

// ─── Stats Overlay ────────────────────────────────────────────────────────────

interface StatsOverlayProps {
    faces: number;
    vertices: number;
    topology?: string;
}

function StatsOverlay({ faces, vertices, topology = 'Triangle' }: StatsOverlayProps) {
    const fmt = (n: number) => n.toLocaleString('en-US');
    return (
        <div
            style={{
                position: 'absolute',
                top: 12,
                left: 24,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(26,26,46,0.8)',
                border: '1px solid #333355',
                backdropFilter: 'blur(4px)',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                fontSize: 11,
                color: '#94a3b8',
                lineHeight: 1.7,
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: 10,
            }}
        >
            <div>
                Faces: <span style={{ color: '#f5a623' }}>{fmt(faces)}</span>
            </div>
            <div>
                Vertices: <span style={{ color: '#f5a623' }}>{fmt(vertices)}</span>
            </div>
            <div>
                Topology: <span style={{ color: '#94a3b8' }}>{topology}</span>
            </div>
        </div>
    );
}

// ─── Crosshair Overlay ────────────────────────────────────────────────────────

function CrosshairOverlay() {
    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 20,
            }}
        >
            <div
                style={{
                    width: 24,
                    height: 24,
                    position: 'relative',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: 0,
                        right: 0,
                        height: 1,
                        background: 'rgba(255,255,255,0.7)',
                        transform: 'translateY(-50%)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: 'rgba(255,255,255,0.7)',
                        transform: 'translateX(-50%)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.9)',
                        transform: 'translate(-50%,-50%)',
                    }}
                />
            </div>
        </div>
    );
}

// ─── First Person Hint Banner ─────────────────────────────────────────────────

function FirstPersonHint({ onExit }: { onExit: () => void }) {
    return (
        <div
            style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                padding: '6px 16px',
                borderRadius: 20,
                background: 'rgba(26,26,46,0.9)',
                border: '1px solid #f5a623',
                color: '#f5a623',
                fontSize: 12,
                fontFamily: 'system-ui, sans-serif',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                zIndex: 30,
                pointerEvents: 'auto',
            }}
        >
            <span>WASD to move · ESC to exit</span>
            <button
                onClick={onExit}
                style={{
                    background: 'none',
                    border: '1px solid #f5a623',
                    color: '#f5a623',
                    borderRadius: 4,
                    padding: '1px 8px',
                    cursor: 'pointer',
                    fontSize: 11,
                }}
            >
                Exit
            </button>
        </div>
    );
}

// ─── Split View ───────────────────────────────────────────────────────────────

interface SplitViewportProps
    extends Omit<
        ThreeViewportProps,
        'splitView' | 'className' | 'showStats' | 'statsData'
    > {
    leftLabel: string;
    rightLabel: string;
}

function SplitViewport({
    leftLabel,
    rightLabel,
    modelUrl,
    pointCloudUrl,
    showGrid,
    showAxes,
    hdrUrl,
    children,
}: SplitViewportProps) {
    return (
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            {/* Left panel */}
            <div style={{ flex: 1, position: 'relative', borderRight: '1px solid #333355' }}>
                <Canvas
                    shadows
                    gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
                    style={{ background: '#1a1a2e' }}
                >
                    <Suspense fallback={null}>
                        <MainScene
                            modelUrl={modelUrl}
                            pointCloudUrl={pointCloudUrl}
                            showGrid={showGrid}
                            showAxes={showAxes}
                            hdrUrl={hdrUrl}
                            renderMode="solid"
                        >
                            {children}
                        </MainScene>
                    </Suspense>
                </Canvas>
                <div
                    style={{
                        position: 'absolute',
                        bottom: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(26,26,46,0.8)',
                        border: '1px solid #333355',
                        borderRadius: 6,
                        padding: '3px 10px',
                        fontSize: 11,
                        color: '#94a3b8',
                        pointerEvents: 'none',
                    }}
                >
                    {leftLabel}
                </div>
            </div>

            {/* Right panel */}
            <div style={{ flex: 1, position: 'relative' }}>
                <Canvas
                    shadows
                    gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
                    style={{ background: '#1a1a2e' }}
                >
                    <Suspense fallback={null}>
                        <MainScene
                            modelUrl={modelUrl}
                            pointCloudUrl={pointCloudUrl}
                            showGrid={showGrid}
                            showAxes={showAxes}
                            hdrUrl={hdrUrl}
                            renderMode="wireframe"
                        >
                            {children}
                        </MainScene>
                    </Suspense>
                </Canvas>
                <div
                    style={{
                        position: 'absolute',
                        bottom: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(26,26,46,0.8)',
                        border: '1px solid #333355',
                        borderRadius: 6,
                        padding: '3px 10px',
                        fontSize: 11,
                        color: '#94a3b8',
                        pointerEvents: 'none',
                    }}
                >
                    {rightLabel}
                </div>
            </div>
        </div>
    );
}

// ─── Main Exported Component ──────────────────────────────────────────────────

export default function ThreeViewport({
    modelUrl,
    pointCloudUrl,
    showGrid = true,
    showAxes = true,
    transformMode = null,
    renderMode = 'textured',
    selectedObjectId,
    onObjectSelect,
    onTransformChange,
    onTransformDragStart,
    onTransformDragEnd,
    showStats = false,
    enableFirstPerson = false,
    splitView = false,
    leftContent = 'original',
    rightContent = 'wireframe',
    segmentColors,
    hdrUrl,
    children,
    className = '',
    statsData,
    isGenerating = false,
    onSceneReady,
    onSceneGraphChange,
    selectedObjectIds,
    onObjectMultiSelect,
    onThumbnailReady,
    onHasSkinnedMesh,
}: ThreeViewportProps) {
    const [isFirstPerson, setIsFirstPerson] = useState(false);
    const [sceneStats, setSceneStats] = useState({ faces: 0, vertices: 0 });
    const [hasSkinnedMesh, setHasSkinnedMesh] = useState(false);

    // Reset SkinnedMesh flag whenever the model URL changes
    useEffect(() => { setHasSkinnedMesh(false); }, [modelUrl]);

    // Sync first person mode with enableFirstPerson prop
    useEffect(() => {
        setIsFirstPerson(enableFirstPerson);
    }, [enableFirstPerson]);

    const handleExitFirstPerson = useCallback(() => {
        setIsFirstPerson(false);
    }, []);

    const handleSceneStats = useCallback(
        (stats: { faces: number; vertices: number }) => {
            setSceneStats(stats);
        },
        []
    );

    const displayStats = statsData ?? sceneStats;

    // ── Split View ──────────────────────────────────────────────────────────────
    if (splitView) {
        const leftLabel = leftContent === 'original' ? 'Original' : 'Wireframe';
        const rightLabel = rightContent === 'retopo' ? 'Retopo Result' : 'Wireframe';
        return (
            <div
                className={className}
                style={{ position: 'relative', width: '100%', height: '100%' }}
            >
                <ViewportErrorBoundary>
                    <SplitViewport
                        leftLabel={leftLabel}
                        rightLabel={rightLabel}
                        modelUrl={modelUrl}
                        pointCloudUrl={pointCloudUrl}
                        showGrid={showGrid}
                        showAxes={showAxes}
                        hdrUrl={hdrUrl}
                    >
                        {children}
                    </SplitViewport>
                </ViewportErrorBoundary>
            </div>
        );
    }

    // ── Single Canvas ───────────────────────────────────────────────────────────
    return (
        <div
            className={className}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: '#1a1a2e',
            }}
        >
            <ViewportErrorBoundary>
                <Suspense fallback={<ViewportLoadingFallback />}>
                    <Canvas
                        shadows
                        gl={{
                            antialias: true,
                            toneMapping: THREE.ACESFilmicToneMapping,
                            toneMappingExposure: 1.2,
                            outputColorSpace: THREE.SRGBColorSpace,
                            preserveDrawingBuffer: !!onThumbnailReady,
                        }}
                        style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
                        onPointerMissed={(e) => {
                            if (e.type === 'click') onObjectSelect?.(null);
                        }}
                    >
                        <Suspense fallback={null}>
                            <MainScene
                                modelUrl={modelUrl}
                                pointCloudUrl={pointCloudUrl}
                                showGrid={showGrid}
                                showAxes={showAxes}
                                transformMode={transformMode}
                                renderMode={renderMode}
                                selectedObjectId={selectedObjectId}
                                onObjectSelect={onObjectSelect}
                                onTransformChange={onTransformChange}
                                onTransformDragStart={onTransformDragStart}
                                onTransformDragEnd={onTransformDragEnd}
                                segmentColors={segmentColors}
                                hdrUrl={hdrUrl}
                                isFirstPerson={isFirstPerson}
                                onExitFirstPerson={handleExitFirstPerson}
                                onSceneStats={showStats && !statsData ? handleSceneStats : undefined}
                                isGenerating={isGenerating}
                                onSceneReady={onSceneReady}
                                onSceneGraphChange={onSceneGraphChange}
                                selectedObjectIds={selectedObjectIds}
                                onObjectMultiSelect={onObjectMultiSelect}
                                onThumbnailReady={onThumbnailReady}
                                onHasSkinnedMesh={(v) => {
                                    setHasSkinnedMesh(v);
                                    onHasSkinnedMesh?.(v);
                                }}
                            >
                                {children}
                            </MainScene>
                        </Suspense>
                    </Canvas>
                </Suspense>
            </ViewportErrorBoundary>

            {/* HTML Overlays (outside Canvas) */}

            {/* SkinnedMesh warning banner */}
            {hasSkinnedMesh && (
                <div
                    style={{
                        position: 'absolute',
                        top: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(120,53,15,0.85)',
                        border: '1px solid rgba(245,158,11,0.5)',
                        borderRadius: 20,
                        padding: '3px 12px',
                        fontSize: 11,
                        color: '#fcd34d',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        pointerEvents: 'none',
                        zIndex: 30,
                        backdropFilter: 'blur(6px)',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <span style={{ fontSize: 12 }}>🦴</span>
                    Armature model — individual bone movements may not move correctly
                </div>
            )}

            {/* Stats */}
            {showStats && displayStats.faces > 0 && (
                <StatsOverlay
                    faces={displayStats.faces}
                    vertices={displayStats.vertices}
                    topology={statsData?.topology ?? 'Triangle'}
                />
            )}

            {/* First-person crosshair */}
            {isFirstPerson && <CrosshairOverlay />}

            {/* First-person hint */}
            {isFirstPerson && <FirstPersonHint onExit={handleExitFirstPerson} />}
        </div>
    );
}
