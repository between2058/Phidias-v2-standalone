'use client';

import React, { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Box,
  Layers,
  Eye,
  EyeOff,
  Copy,
  Trash2,
} from 'lucide-react';
import type { CADNode, DuplicateGroup } from '@/lib/occt-bridge';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CADHierarchyTreeProps {
  root: CADNode | null;
  duplicates: DuplicateGroup[];
  selectedNodeId: string | null;
  highlightedMeshIndices: Set<number>;
  onNodeSelect: (nodeId: string, meshIndices: number[]) => void;
  onNodeVisibilityToggle: (nodeId: string, visible: boolean) => void;
  onDeleteDuplicates: (group: DuplicateGroup) => void;
  showDuplicatesTab?: boolean;
}

// ─── Tree Node ───────────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  selectedNodeId,
  onSelect,
  hiddenNodes,
  onToggleVisibility,
}: {
  node: CADNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: (nodeId: string, meshIndices: number[]) => void;
  hiddenNodes: Set<string>;
  onToggleVisibility: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const hasMeshes = node.meshIndices.length > 0;
  const isSelected = selectedNodeId === node.id;
  const isHidden = hiddenNodes.has(node.id);

  // Collect all mesh indices for this node and its descendants
  const collectMeshIndices = useCallback((n: CADNode): number[] => {
    const indices = [...n.meshIndices];
    for (const child of n.children) {
      indices.push(...collectMeshIndices(child));
    }
    return indices;
  }, []);

  return (
    <div>
      <div
        className={`
          flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer group
          ${isSelected ? 'bg-[#D5B451]/20 text-white' : 'text-[#94a3b8] hover:bg-[#ffffff08]'}
          ${isHidden ? 'opacity-40' : ''}
        `}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(node.id, collectMeshIndices(node))}
      >
        {/* Expand/collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(v => !v);
          }}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        >
          {hasChildren ? (
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span className="w-3" />
          )}
        </button>

        {/* Icon */}
        {hasChildren ? (
          <Layers size={12} className="flex-shrink-0 text-[#D5B451]" />
        ) : (
          <Box size={12} className="flex-shrink-0 text-[#7c8db5]" />
        )}

        {/* Name */}
        <span className="text-[11px] truncate flex-1">{node.name}</span>

        {/* Mesh count badge */}
        {hasMeshes && (
          <span className="text-[9px] text-[#4b5563] font-mono mr-1">
            {node.meshIndices.length}
          </span>
        )}

        {/* Visibility toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node.id);
          }}
          className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
        </button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              hiddenNodes={hiddenNodes}
              onToggleVisibility={onToggleVisibility}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CADHierarchyTree({
  root,
  duplicates,
  selectedNodeId,
  highlightedMeshIndices: _highlightedMeshIndices,
  onNodeSelect,
  onNodeVisibilityToggle,
  onDeleteDuplicates,
}: CADHierarchyTreeProps) {
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'duplicates'>('hierarchy');
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());

  const handleToggleVisibility = useCallback(
    (nodeId: string) => {
      setHiddenNodes(prev => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
          onNodeVisibilityToggle(nodeId, true);
        } else {
          next.add(nodeId);
          onNodeVisibilityToggle(nodeId, false);
        }
        return next;
      });
    },
    [onNodeVisibilityToggle],
  );

  // Count total parts
  const countParts = useCallback((node: CADNode): number => {
    let count = node.meshIndices.length;
    for (const child of node.children) {
      count += countParts(child);
    }
    return count;
  }, []);

  const totalParts = root ? countParts(root) : 0;
  const totalDuplicates = duplicates.reduce((sum, g) => sum + g.count - 1, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-[#333355]">
        <button
          onClick={() => setActiveTab('hierarchy')}
          className={`flex-1 py-2 text-[10px] font-medium transition-colors ${
            activeTab === 'hierarchy'
              ? 'text-white border-b-2 border-[#D5B451]'
              : 'text-[#64748b] hover:text-[#94a3b8]'
          }`}
        >
          Hierarchy ({totalParts})
        </button>
        <button
          onClick={() => setActiveTab('duplicates')}
          className={`flex-1 py-2 text-[10px] font-medium transition-colors ${
            activeTab === 'duplicates'
              ? 'text-white border-b-2 border-[#D5B451]'
              : 'text-[#64748b] hover:text-[#94a3b8]'
          }`}
        >
          Duplicates
          {totalDuplicates > 0 && (
            <span className="ml-1 px-1 py-0.5 rounded-full text-[9px] bg-[#f5a623]/20 text-[#f5a623]">
              {totalDuplicates}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {activeTab === 'hierarchy' && root && (
          <TreeNode
            node={root}
            depth={0}
            selectedNodeId={selectedNodeId}
            onSelect={onNodeSelect}
            hiddenNodes={hiddenNodes}
            onToggleVisibility={handleToggleVisibility}
          />
        )}

        {activeTab === 'hierarchy' && !root && (
          <div className="flex flex-col items-center justify-center h-full text-[#4b5563]">
            <Layers size={24} className="mb-2 opacity-30" />
            <p className="text-[10px]">Import a CAD file to see hierarchy</p>
          </div>
        )}

        {activeTab === 'duplicates' && (
          <div className="px-2 py-1 space-y-1">
            {duplicates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-[#4b5563]">
                <Copy size={24} className="mb-2 opacity-30" />
                <p className="text-[10px]">
                  {root ? 'No duplicate parts detected' : 'Import a file first'}
                </p>
              </div>
            ) : (
              duplicates.map((group) => (
                <div
                  key={group.hash}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-[#13132a] border border-[#333355] group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Copy size={12} className="text-[#f5a623] flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-[#94a3b8] truncate">{group.name}</p>
                      <p className="text-[9px] text-[#4b5563]">
                        {group.count} identical copies
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteDuplicates(group)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[9px] text-[#ef4444] hover:bg-[#ef4444]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove duplicates (keep one)"
                  >
                    <Trash2 size={10} />
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
