import { useRef, useEffect, useCallback, useMemo } from 'react';

export interface ForceNode {
  id: string;
  label: string;
  type: string;
  detail: string;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  floatPhase: number;
  floatSpeed: number;
  layer: number;
  meta?: Record<string, string>;
}

export interface ForceEdge {
  source: string;
  target: string;
  label?: string;
}

export function makeForceNode(
  id: string, label: string, type: string, radius: number, mass: number, layer: number, detail: string, meta?: Record<string, string>
): ForceNode {
  return {
    id, label, type, x: 0, y: 0, baseX: 0, baseY: 0, vx: 0, vy: 0, radius, mass,
    floatPhase: Math.random() * Math.PI * 2,
    floatSpeed: 0.0004 + Math.random() * 0.0008,
    layer, detail, meta,
  };
}

const TYPE_COLORS: Record<string, string> = {
  person: '#e11d48',
  org: '#2563eb',
  location: '#059669',
  concept: '#7c3aed',
  metric: '#d97706',
  event: '#0891b2',
  project: '#1e3a5f',
  agent: '#0d9488',
  skill: '#7c3aed',
  file: '#475569',
  insight: '#dc2626',
};

const TYPE_LABELS: Record<string, string> = {
  person: '人物',
  org: '组织',
  location: '地点',
  concept: '概念',
  metric: '指标',
  event: '事件',
  project: '项目',
  agent: 'Agent',
  skill: 'Skill',
  file: '文件',
  insight: '洞察',
};

function getNodeColor(type: string, isHovered: boolean, isDragged: boolean): string {
  if (isDragged) return '#2563eb';
  if (isHovered) return '#3b82f6';
  return TYPE_COLORS[type] || '#52525b';
}

interface ForceGraphProps {
  nodes: ForceNode[];
  edges: ForceEdge[];
  expandedIds?: Set<string>;
  expandableIds?: Set<string>;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  className?: string;
}

export default function ForceGraph({
  nodes,
  edges,
  expandedIds,
  expandableIds,
  onNodeClick,
  onNodeDoubleClick,
  className = '',
}: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const graphRef = useRef<{ nodes: ForceNode[]; edges: ForceEdge[] }>({ nodes: [], edges: [] });
  const draggedRef = useRef<ForceNode | null>(null);
  const hoveredRef = useRef<ForceNode | null>(null);
  const propsRef = useRef({ expandedIds, expandableIds, onNodeClick, onNodeDoubleClick });
  const prevNodeIdsRef = useRef<Set<string>>(new Set());

  propsRef.current = { expandedIds, expandableIds, onNodeClick, onNodeDoubleClick };

  const stableExpandedIds = useMemo(() => expandedIds, [expandedIds]);
  const stableExpandableIds = useMemo(() => expandableIds, [expandableIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const W = rect.width || 400;
    const H = rect.height || 300;

    const prevIds = prevNodeIdsRef.current;
    const newIds = new Set(nodes.map(n => n.id));
    const incomingNodes = nodes.filter(n => !prevIds.has(n.id));
    const existingMap = new Map<string, ForceNode>();
    graphRef.current.nodes.forEach(n => {
      if (newIds.has(n.id)) existingMap.set(n.id, n);
    });

    const mergedNodes: ForceNode[] = nodes.map(n => {
      const existing = existingMap.get(n.id);
      if (existing) {
        existing.label = n.label;
        existing.type = n.type;
        existing.detail = n.detail;
        existing.meta = n.meta;
        return existing;
      }
      return n;
    });

    if (prevIds.size === 0 && mergedNodes.length > 0) {
      const cx = W / 2, cy = H / 2;
      const minDim = Math.min(W, H);
      mergedNodes.forEach((n, i) => {
        const angle = (i / Math.max(1, mergedNodes.length)) * Math.PI * 2 + Math.random() * 0.6;
        const r = minDim * (0.15 + Math.random() * 0.2);
        n.x = cx + Math.cos(angle) * r;
        n.y = cy + Math.sin(angle) * r;
      });
    } else if (incomingNodes.length > 0) {
      const nodeMap = new Map<string, ForceNode>();
      mergedNodes.forEach(n => nodeMap.set(n.id, n));

      incomingNodes.forEach(n => {
        let parentX = W / 2, parentY = H / 2;
        for (const e of edges) {
          if (e.source === n.id && nodeMap.has(e.target)) {
            const p = nodeMap.get(e.target)!;
            parentX = p.x; parentY = p.y;
            break;
          }
          if (e.target === n.id && nodeMap.has(e.source)) {
            const p = nodeMap.get(e.source)!;
            parentX = p.x; parentY = p.y;
            break;
          }
        }
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 40;
        n.x = parentX + Math.cos(angle) * dist;
        n.y = parentY + Math.sin(angle) * dist;
      });
    }

    const edgeMap = new Map<string, ForceNode>();
    mergedNodes.forEach(n => edgeMap.set(n.id, n));

    const degree = new Map<string, number>();
    edges.forEach(e => {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    });
    mergedNodes.forEach(n => {
      const d = degree.get(n.id) || 0;
      if (d >= 6) { n.radius = 14; n.mass = 1 + d * 0.3; }
      else if (d >= 4) { n.radius = 10; n.mass = 1 + d * 0.3; }
      else if (d >= 2) { n.radius = 7; n.mass = 1 + d * 0.3; }
      else { n.radius = 5.5; n.mass = 1; }
    });

    const iters = Math.min(80, Math.max(30, 60 - mergedNodes.length));
    for (let f = 0; f < iters; f++) {
      for (let i = 0; i < mergedNodes.length; i++) {
        for (let j = i + 1; j < mergedNodes.length; j++) {
          const a = mergedNodes[i], b = mergedNodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist > 300) continue;
          const force = (400 * a.mass * b.mass) / (dist * dist);
          a.vx -= (dx / dist) * force / a.mass;
          a.vy -= (dy / dist) * force / a.mass;
          b.vx += (dx / dist) * force / b.mass;
          b.vy += (dy / dist) * force / b.mass;
        }
      }
      edges.forEach(e => {
        const a = edgeMap.get(e.source);
        const b = edgeMap.get(e.target);
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.008;
        a.vx += (dx / dist) * force / a.mass;
        a.vy += (dy / dist) * force / a.mass;
        b.vx -= (dx / dist) * force / b.mass;
        b.vy -= (dy / dist) * force / b.mass;
      });
      const pad = 30;
      mergedNodes.forEach(n => {
        if (n.x < pad) n.vx += (pad - n.x) * 0.04;
        if (n.x > W - pad) n.vx -= (n.x - (W - pad)) * 0.04;
        if (n.y < pad) n.vy += (pad - n.y) * 0.04;
        if (n.y > H - pad) n.vy -= (n.y - (H - pad)) * 0.04;
        n.vx *= 0.9; n.vy *= 0.9;
        n.x += n.vx; n.y += n.vy;
      });
    }

    mergedNodes.forEach(n => { n.baseX = n.x; n.baseY = n.y; n.vx = 0; n.vy = 0; });
    graphRef.current = { nodes: mergedNodes, edges };
    prevNodeIdsRef.current = newIds;

    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(render);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width;
    const H = rect.height;

    if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    }

    const { nodes: gNodes, edges: gEdges } = graphRef.current;
    const nodeMap = new Map<string, ForceNode>();
    gNodes.forEach(n => nodeMap.set(n.id, n));
    const { expandedIds: expIds, expandableIds: expableIds } = propsRef.current;

    if (gNodes.length === 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '13px "Inter", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无实体数据', W / 2, H / 2 - 8);
      ctx.font = '11px "Inter", -apple-system, sans-serif';
      ctx.fillText('上传文档后将自动抽取', W / 2, H / 2 + 12);
      ctx.textAlign = 'start';
      animRef.current = requestAnimationFrame(render);
      return;
    }

    const now = Date.now();
    gNodes.forEach(n => {
      if (n === draggedRef.current) {
        n.vx = 0; n.vy = 0; n.baseX = n.x; n.baseY = n.y;
        return;
      }
      n.vx += (Math.random() - 0.5) * 0.01;
      n.vy += (Math.random() - 0.5) * 0.01;
      n.vx += (n.baseX - n.x) * 0.008;
      n.vy += (n.baseY - n.y) * 0.008;
    });
    if (gNodes.length <= 40) {
      for (let i = 0; i < gNodes.length; i++) {
        for (let j = i + 1; j < gNodes.length; j++) {
          const a = gNodes[i], b = gNodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist > 200) continue;
          const force = (100 * a.mass * b.mass) / (dist * dist);
          a.vx -= (dx / dist) * force / a.mass;
          a.vy -= (dy / dist) * force / a.mass;
          b.vx += (dx / dist) * force / b.mass;
          b.vy += (dy / dist) * force / b.mass;
        }
      }
    }
    gEdges.forEach(e => {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 120) * 0.002;
      a.vx += (dx / dist) * force / a.mass;
      a.vy += (dy / dist) * force / a.mass;
      b.vx -= (dx / dist) * force / b.mass;
      b.vy -= (dy / dist) * force / b.mass;
    });
    const pad = 30;
    gNodes.forEach(n => {
      if (n.x < pad) n.vx += (pad - n.x) * 0.02;
      if (n.x > W - pad) n.vx -= (n.x - (W - pad)) * 0.02;
      if (n.y < pad) n.vy += (pad - n.y) * 0.02;
      if (n.y > H - pad) n.vy -= (n.y - (H - pad)) * 0.02;
      n.vx *= 0.97; n.vy *= 0.97;
      n.x += n.vx; n.y += n.vy;
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    gEdges.forEach(e => {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) return;
      const ax = a.x + Math.sin(now * a.floatSpeed + a.floatPhase) * 0.5;
      const ay = a.y + Math.cos(now * a.floatSpeed * 0.7 + a.floatPhase) * 0.4;
      const bx = b.x + Math.sin(now * b.floatSpeed + b.floatPhase) * 0.5;
      const by = b.y + Math.cos(now * b.floatSpeed * 0.7 + b.floatPhase) * 0.4;
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      if (e.label) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '9px "Inter", -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, mx, my - 3);
        ctx.textAlign = 'start';
      }
    });

    gNodes.forEach(n => {
      const fx = Math.sin(now * n.floatSpeed + n.floatPhase) * 0.5;
      const fy = Math.cos(now * n.floatSpeed * 0.7 + n.floatPhase) * 0.4;
      const rx = n.x + fx, ry = n.y + fy;
      const color = getNodeColor(n.type, hoveredRef.current?.id === n.id, draggedRef.current?.id === n.id);
      const isExpanded = expIds?.has(n.id);
      const isExpandable = expableIds?.has(n.id);

      if (isExpanded) {
        ctx.beginPath();
        ctx.arc(rx, ry, n.radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = color + '40';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowColor = 'rgba(0,0,0,0.06)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(rx, ry, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      if (isExpandable && !isExpanded) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${n.radius > 8 ? 12 : 10}px "Inter", -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', rx, ry + 0.5);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }

      ctx.fillStyle = color;
      ctx.font = `${n.radius > 8 ? 11 : 10}px "Inter", -apple-system, sans-serif`;
      ctx.fillText(n.label, rx + n.radius + 6, ry + 3.5);
    });

    animRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    const posOf = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const hitTest = (x: number, y: number) => {
      const now = Date.now();
      for (const n of graphRef.current.nodes) {
        const fx = Math.sin(now * n.floatSpeed + n.floatPhase) * 0.5;
        const fy = Math.cos(now * n.floatSpeed * 0.7 + n.floatPhase) * 0.4;
        const dx = x - (n.x + fx), dy = y - (n.y + fy);
        if (dx * dx + dy * dy < (n.radius + 6) ** 2) return n;
      }
      return null;
    };

    let didDrag = false;

    const onDown = (e: MouseEvent) => {
      const hit = hitTest(posOf(e).x, posOf(e).y);
      didDrag = false;
      if (hit) draggedRef.current = hit;
    };

    const onMove = (e: MouseEvent) => {
      const p = posOf(e);
      if (draggedRef.current) {
        didDrag = true;
        draggedRef.current.x = p.x;
        draggedRef.current.y = p.y;
      }
      const hit = hitTest(p.x, p.y);
      hoveredRef.current = hit;
      canvas.style.cursor = draggedRef.current ? 'grabbing' : hit ? 'pointer' : 'default';

      const tip = tooltipRef.current;
      if (tip) {
        if (hit) {
          const typeLabel = TYPE_LABELS[hit.type] || hit.type;
          const metaRows = hit.meta
            ? Object.entries(hit.meta).map(([k, v]) => `<div class="flex justify-between text-[10px]"><span class="text-text-muted">${k}</span><span>${v}</span></div>`).join('')
            : '';
          tip.innerHTML = `<div class="text-[10px] text-text-muted mb-0.5">${typeLabel}</div><div class="text-xs font-semibold mb-1">${hit.label}</div><div class="text-[11px] text-text-secondary mb-1">${hit.detail}</div>${metaRows ? `<div class="border-t border-border pt-1 mt-1 space-y-0.5">${metaRows}</div>` : ''}`;
          tip.style.display = 'block';
          const cRect = canvas.getBoundingClientRect();
          let tx = p.x + 14, ty = p.y + 14;
          if (tx + 200 > cRect.width) tx = p.x - 200;
          if (ty + 120 > cRect.height) ty = p.y - 120;
          tip.style.left = tx + 'px';
          tip.style.top = ty + 'px';
        } else {
          tip.style.display = 'none';
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      const wasDragging = draggedRef.current;
      draggedRef.current = null;
      if (wasDragging && didDrag) return;

      const hit = hitTest(posOf(e).x, posOf(e).y);
      if (!hit) return;

      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        propsRef.current.onNodeDoubleClick?.(hit.id);
      } else {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          propsRef.current.onNodeClick?.(hit.id);
        }, 250);
      }
    };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (clickTimer) clearTimeout(clickTimer);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-surface border border-border rounded-xl shadow-lg px-3 py-2 w-48 z-20"
        style={{ display: 'none' }}
      />
    </div>
  );
}

export { TYPE_COLORS, TYPE_LABELS };
