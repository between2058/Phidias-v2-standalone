'use client';

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface CADViewportProps {
  threeGroup: THREE.Group | null;
  highlightedMeshIndices: Set<number>;
  hiddenNodeIds: Set<string>;
  onMeshClick?: (meshIndex: number | null) => void;
  className?: string;
}

const HIGHLIGHT_EMISSIVE = new THREE.Color(0.3, 0.25, 0.1);

export default function CADViewport({
  threeGroup,
  highlightedMeshIndices,
  hiddenNodeIds: _hiddenNodeIds,
  onMeshClick,
  className,
}: CADViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const frameIdRef = useRef<number>(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const originalMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material>>(new Map());

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.01,
      1000,
    );
    camera.position.set(3, 2, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(5, 10, 7);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight2.position.set(-5, 5, -5);
    scene.add(dirLight2);

    // Grid
    const grid = new THREE.GridHelper(20, 40, 0x333355, 0x222244);
    scene.add(grid);

    // Render loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Add/remove the model group
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous group
    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current = null;
      originalMaterialsRef.current.clear();
    }

    if (threeGroup) {
      scene.add(threeGroup);
      groupRef.current = threeGroup;

      // Store original materials
      threeGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          originalMaterialsRef.current.set(obj, obj.material);
        }
      });

      // Fit camera to model
      const box = new THREE.Box3().setFromObject(threeGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      if (controlsRef.current && cameraRef.current) {
        controlsRef.current.target.copy(center);
        cameraRef.current.position.set(
          center.x + maxDim * 1.5,
          center.y + maxDim * 0.8,
          center.z + maxDim * 1.5,
        );
        controlsRef.current.update();
      }
    }
  }, [threeGroup]);

  // Handle highlighting
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    let meshIndex = 0;
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const currentIndex = meshIndex++;
        const originalMat = originalMaterialsRef.current.get(obj);
        if (!originalMat) return;

        if (highlightedMeshIndices.has(currentIndex)) {
          const hlMat = (originalMat as THREE.MeshStandardMaterial).clone();
          hlMat.emissive = HIGHLIGHT_EMISSIVE;
          hlMat.emissiveIntensity = 1.0;
          obj.material = hlMat;
        } else {
          obj.material = originalMat;
        }
      }
    });
  }, [highlightedMeshIndices]);

  // Handle click → select mesh
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onMeshClick || !containerRef.current || !cameraRef.current || !groupRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const intersects = raycasterRef.current.intersectObject(groupRef.current, true);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        // Find mesh index
        let meshIndex = 0;
        let foundIndex = -1;
        groupRef.current.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            if (obj === hit) foundIndex = meshIndex;
            meshIndex++;
          }
        });
        onMeshClick(foundIndex >= 0 ? foundIndex : null);
      } else {
        onMeshClick(null);
      }
    },
    [onMeshClick],
  );

  // Stats
  const stats = useMemo(() => {
    if (!threeGroup) return null;
    let faces = 0;
    let vertices = 0;
    let meshCount = 0;
    threeGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshCount++;
        const geo = obj.geometry;
        vertices += geo.attributes.position?.count || 0;
        if (geo.index) {
          faces += geo.index.count / 3;
        }
      }
    });
    return { faces: Math.round(faces), vertices, meshCount };
  }, [threeGroup]);

  return (
    <div ref={containerRef} className={`relative ${className || ''}`} onClick={handleClick}>
      {/* Stats overlay */}
      {stats && (
        <div
          className="absolute top-3 right-3 px-2 py-1.5 rounded text-[10px] font-mono z-10"
          style={{ background: 'rgba(13,13,24,0.85)', border: '1px solid #333355' }}
        >
          <div className="text-[#94a3b8]">
            <span className="text-[#D5B451]">{stats.meshCount.toLocaleString()}</span> parts
            {' | '}
            <span className="text-[#D5B451]">{stats.faces.toLocaleString()}</span> faces
            {' | '}
            <span className="text-[#D5B451]">{stats.vertices.toLocaleString()}</span> verts
          </div>
        </div>
      )}
    </div>
  );
}
