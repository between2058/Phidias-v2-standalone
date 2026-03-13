'use client';

import React, { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import CADImportPanel from '@/components/cad/CADImportPanel';
import CADHierarchyTree from '@/components/cad/CADHierarchyTree';
import {
  importStepFile,
  cadResultToThreeGroup,
  detectDuplicates,
  expandHierarchy,
} from '@/lib/occt-bridge';
import type {
  CADImportProgress,
  CADImportResult,
  DuplicateGroup,
} from '@/lib/occt-bridge';
import type * as THREE from 'three';

const CADViewport = dynamic(() => import('@/components/cad/CADViewport'), {
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function CADPage() {
  // Import state
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<CADImportProgress | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // CAD data
  const [cadResult, setCadResult] = useState<CADImportResult | null>(null);
  const [threeGroup, setThreeGroup] = useState<THREE.Group | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);

  // Selection state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedMeshIndices, setHighlightedMeshIndices] = useState<Set<number>>(new Set());
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());

  // Handle file import
  const handleFileSelect = useCallback(async (file: File) => {
    setIsLoading(true);
    setProgress({ stage: 'Reading file...', percent: 0 });
    setError(null);
    setSelectedNodeId(null);
    setHighlightedMeshIndices(new Set());
    setHiddenNodeIds(new Set());

    setFileInfo({ name: file.name, size: formatFileSize(file.size) });

    try {
      const rawResult = await importStepFile(file, setProgress);
      const result = expandHierarchy(rawResult);

      setCadResult(result);
      setDuplicates(detectDuplicates(result.meshes));

      // Convert to Three.js
      const group = cadResultToThreeGroup(result);
      setThreeGroup(group);
    } catch (err: unknown) {
      console.error('CAD import failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to import file');
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  }, []);

  // Tree selection → highlight meshes in viewport
  const handleNodeSelect = useCallback((nodeId: string, meshIndices: number[]) => {
    setSelectedNodeId(nodeId);
    setHighlightedMeshIndices(new Set(meshIndices));
  }, []);

  // Visibility toggle
  const handleNodeVisibilityToggle = useCallback((nodeId: string, visible: boolean) => {
    setHiddenNodeIds(prev => {
      const next = new Set(prev);
      if (visible) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
    // Toggle visibility on the Three.js group
    if (threeGroup) {
      const findAndToggle = (obj: THREE.Object3D) => {
        // Match by name pattern from node
        if (obj.name && nodeId.includes(obj.name)) {
          obj.visible = visible;
        }
        obj.children.forEach(findAndToggle);
      };
      findAndToggle(threeGroup);
    }
  }, [threeGroup]);

  // Mesh click in viewport → find which node owns it
  const handleMeshClick = useCallback((meshIndex: number | null) => {
    if (meshIndex === null) {
      setSelectedNodeId(null);
      setHighlightedMeshIndices(new Set());
      return;
    }
    setHighlightedMeshIndices(new Set([meshIndex]));
  }, []);

  // Delete duplicates
  const handleDeleteDuplicates = useCallback((group: DuplicateGroup) => {
    if (!threeGroup) return;

    // Keep the first, hide the rest
    const indicesToHide = group.meshIndices.slice(1);
    let meshIndex = 0;
    threeGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        if (indicesToHide.includes(meshIndex)) {
          obj.visible = false;
        }
        meshIndex++;
      }
    });

    // Update duplicates list (remove this group)
    setDuplicates(prev => prev.filter(g => g.hash !== group.hash));
  }, [threeGroup]);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: '#1a1a2e' }}>
      {/* Left panel — Import + Hierarchy */}
      <aside
        className="w-[280px] flex-shrink-0 overflow-hidden flex flex-col border-r"
        style={{ background: '#1e1e36', borderColor: '#333355' }}
      >
        {/* Import section */}
        <div className="border-b border-[#333355]" style={{ minHeight: '200px' }}>
          <CADImportPanel
            onFileSelect={handleFileSelect}
            isLoading={isLoading}
            progress={progress}
            fileInfo={fileInfo}
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="px-3 py-2 bg-[#ef4444]/10 border-b border-[#ef4444]/30">
            <p className="text-[10px] text-[#ef4444]">{error}</p>
          </div>
        )}

        {/* Hierarchy tree */}
        <div className="flex-1 overflow-hidden">
          <CADHierarchyTree
            root={cadResult?.root ?? null}
            duplicates={duplicates}
            selectedNodeId={selectedNodeId}
            highlightedMeshIndices={highlightedMeshIndices}
            onNodeSelect={handleNodeSelect}
            onNodeVisibilityToggle={handleNodeVisibilityToggle}
            onDeleteDuplicates={handleDeleteDuplicates}
          />
        </div>
      </aside>

      {/* Viewport */}
      <main className="flex-1 relative overflow-hidden">
        {threeGroup || isLoading ? (
          <CADViewport
            threeGroup={threeGroup}
            highlightedMeshIndices={highlightedMeshIndices}
            hiddenNodeIds={hiddenNodeIds}
            onMeshClick={handleMeshClick}
            className="w-full h-full"
          />
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center"
            style={{ background: '#1a1a2e' }}
          >
            <div className="text-6xl mb-4 opacity-20">&#9881;</div>
            <p className="text-[#64748b] text-sm">CAD model will appear here</p>
            <p className="text-[#4b5563] text-xs mt-1">
              Import a .STP / .STEP file using the panel on the left
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
