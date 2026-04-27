import { useState, useEffect, useRef } from 'react';
import { FileText, Upload, Loader2, Image, FileSpreadsheet, File, Download, ExternalLink } from 'lucide-react';
import { fetchWorkspaceFiles, uploadDocument, getWorkspaceFileUrl } from '../services/api';
import type { WorkspaceFile } from '../services/api';

interface ProjectFilePanelProps {
  projectId: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return Image;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function getFileTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() || '';
  return ext;
}

function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'md', 'json', 'csv'].includes(ext);
}

async function downloadFile(filename: string) {
  const url = getWorkspaceFileUrl(filename);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}

const MOCK_OUTPUTS = [
  { name: 'Q3营收对比图.png', size: 1.2 * 1024 * 1024 },
  { name: '分析报告.pdf', size: 3.5 * 1024 * 1024 },
  { name: '趋势数据.xlsx', size: 1.6 * 1024 * 1024 },
];

export default function ProjectFilePanel({ projectId }: ProjectFilePanelProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchWorkspaceFiles().then(setFiles).catch(() => {});
  }, [projectId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    try {
      await uploadDocument(file);
      const updated = await fetchWorkspaceFiles();
      setFiles(updated);
    } catch {
      // ignore
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface border-l border-border">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-text">项目文件库</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Upload section */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">上传文件</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
            >
              {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              <span>上传</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.csv,.xlsx,.xls,.json,.py"
              onChange={handleUpload}
              className="hidden"
            />
          </div>

          <div className="space-y-1.5">
            {files.length === 0 && !isUploading && (
              <p className="text-xs text-text-muted py-2 text-center">暂无文件</p>
            )}
            {files.map(f => {
              const Icon = getFileIcon(f.name);
              const previewable = isPreviewable(f.name);
              return (
                <div
                  key={f.name}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-bg transition-colors group"
                >
                  <div className="w-8 h-8 bg-bg border border-border rounded-lg flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text font-medium truncate">{f.name}</p>
                    <p className="text-[10px] text-text-muted">
                      <span className="inline-block bg-bg-muted px-1 rounded mr-1">{getFileTypeLabel(f.name)}</span>
                      {formatFileSize(f.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {previewable && (
                      <button
                        onClick={() => window.open(getWorkspaceFileUrl(f.name), '_blank')}
                        className="p-1 rounded hover:bg-border transition-colors"
                        title="预览"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
                      </button>
                    )}
                    <button
                      onClick={() => downloadFile(f.name)}
                      className="p-1 rounded hover:bg-border transition-colors"
                      title="下载"
                    >
                      <Download className="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Outputs section */}
        <div>
          <div className="mb-2.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">产物</span>
          </div>
          <div className="space-y-1.5">
            {MOCK_OUTPUTS.map(f => {
              const Icon = getFileIcon(f.name);
              return (
                <div
                  key={f.name}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-bg transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 bg-bg border border-border rounded-lg flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text font-medium truncate">{f.name}</p>
                    <p className="text-[10px] text-text-muted">{formatFileSize(f.size)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
