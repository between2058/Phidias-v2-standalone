'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Upload, FileBox, Settings2, ChevronDown, ChevronRight } from 'lucide-react';

interface CADImportPanelProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  progress: { stage: string; percent: number } | null;
  fileInfo: { name: string; size: string } | null;
}

export default function CADImportPanel({
  onFileSelect,
  isLoading,
  progress,
  fileInfo,
}: CADImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [onFileSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <FileBox size={16} className="text-[#D5B451]" />
        <span className="text-xs font-semibold text-white tracking-wide uppercase">
          CAD Import
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={dropRef}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed
          transition-all cursor-pointer
          ${isDragOver
            ? 'border-[#D5B451] bg-[#D5B451]/10'
            : 'border-[#333355] hover:border-[#555577] bg-[#13132a]'
          }
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <Upload size={24} className={isDragOver ? 'text-[#D5B451]' : 'text-[#64748b]'} />
        <p className="text-xs text-[#94a3b8] text-center">
          {isDragOver ? 'Drop file here' : 'Drag & drop or click to select'}
        </p>
        <p className="text-[10px] text-[#4b5563]">
          .STP .STEP .IGES .BREP
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".stp,.step,.iges,.igs,.brep,.brp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Progress */}
      {isLoading && progress && (
        <div className="px-1 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#94a3b8]">{progress.stage}</span>
            <span className="text-[10px] text-[#D5B451] font-mono">{progress.percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1a1a2e] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.percent}%`,
                background: 'linear-gradient(90deg, #D5B451, #f5a623)',
              }}
            />
          </div>
        </div>
      )}

      {/* File info */}
      {fileInfo && !isLoading && (
        <div className="px-2 py-2 rounded-md bg-[#13132a] border border-[#333355]">
          <p className="text-xs text-white truncate">{fileInfo.name}</p>
          <p className="text-[10px] text-[#64748b] mt-0.5">{fileInfo.size}</p>
        </div>
      )}

      {/* Settings */}
      <button
        onClick={() => setShowSettings(v => !v)}
        className="flex items-center gap-1.5 px-1 text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
      >
        {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Settings2 size={12} />
        <span>Import Settings</span>
      </button>

      {showSettings && (
        <div className="px-2 py-2 rounded-md bg-[#13132a] border border-[#333355] space-y-2">
          <p className="text-[10px] text-[#64748b]">
            Tessellation quality and unit settings will be available in a future update.
          </p>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer info */}
      <div className="px-1 py-2 border-t border-[#333355]">
        <p className="text-[10px] text-[#4b5563] leading-relaxed">
          Powered by OpenCascade WASM. Files are processed entirely in your browser.
        </p>
      </div>
    </div>
  );
}
