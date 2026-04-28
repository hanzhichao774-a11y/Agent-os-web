import { useRef, useEffect } from 'react';
import { fetchAgents, fetchSkills, fetchWorkspaceFiles } from '../services/api';
import type { AgentInfo, SkillInfo, WorkspaceFile } from '../services/api';

interface ProjectDashboardProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
}

type NodeType = 'project' | 'agent' | 'skill' | 'file' | 'insight';

interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
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
  detail: string;
  meta?: Record<string, string>;
}

interface GraphEdge {
  source: string;
  target: string;
}

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  project: '项目', agent: 'Agent', skill: 'Skill', file: '文件', insight: '洞察',
};

function makeNode(
  id: string, label: string, type: NodeType, radius: number, mass: number, layer: number, detail: string, meta?: Record<string, string>
): GraphNode {
  return {
    id, label, type, x: 0, y: 0, baseX: 0, baseY: 0, vx: 0, vy: 0, radius, mass,
    floatPhase: Math.random() * Math.PI * 2,
    floatSpeed: 0.0004 + Math.random() * 0.0008,
    layer, detail, meta,
  };
}

function buildGraph(
  projectName: string, projectDesc: string,
  agents: AgentInfo[], skills: SkillInfo[], files: WorkspaceFile[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const inc = (id: string) => degree.set(id, (degree.get(id) || 0) + 1);

  const projectId = 'project-center';
  nodes.push(makeNode(projectId, projectName, 'project', 14, 5, 0, projectDesc || '项目节点'));

  agents.slice(0, 6).forEach(a => {
    const nid = `agent-${a.id}`;
    nodes.push(makeNode(nid, a.name, 'agent', 8.5, 2, 1, a.description || 'Agent', { 类型: 'Agent' }));
    edges.push({ source: projectId, target: nid });
    inc(projectId); inc(nid);
  });

  skills.slice(0, 6).forEach(s => {
    const nid = `skill-${s.id}`;
    nodes.push(makeNode(nid, s.name, 'skill', 6.5, 1.3, 1, s.description || 'Skill', { 类别: s.category || '' }));
    const parentAgent = agents.length > 0 ? nodes.find(n => n.type === 'agent') : null;
    if (parentAgent) {
      edges.push({ source: parentAgent.id, target: nid });
      inc(parentAgent.id); inc(nid);
    } else {
      edges.push({ source: projectId, target: nid });
      inc(projectId); inc(nid);
    }
  });

  files.slice(0, 5).forEach((f, i) => {
    const fid = `file-${i}`;
    nodes.push(makeNode(fid, f.name, 'file', 5.5, 1, 2, '项目文件', { 大小: f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)}MB` : `${(f.size / 1024).toFixed(0)}KB` }));
    edges.push({ source: projectId, target: fid });
    inc(projectId); inc(fid);
  });

  const insights = [
    { text: '数据分析', desc: '基于项目文件的数据分析' },
    { text: '知识检索', desc: '知识库检索与问答' },
  ];
  insights.forEach((kp, i) => {
    const kid = `insight-${i}`;
    nodes.push(makeNode(kid, kp.text, 'insight', 5.5, 1, 2, kp.desc));
    edges.push({ source: projectId, target: kid });
    inc(projectId); inc(kid);
  });

  nodes.forEach(n => {
    const d = degree.get(n.id) || 0;
    if (d >= 6) n.radius = 16;
    else if (d >= 4) n.radius = 11;
    else if (d >= 2) n.radius = 8;
  });

  return { nodes, edges };
}

export default function ProjectDashboard({ projectId, projectName, projectDescription }: ProjectDashboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const graphRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const draggedNodeRef = useRef<GraphNode | null>(null);
  const hoveredNodeRef = useRef<GraphNode | null>(null);

  // Build graph data from API
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      const [agents, skills, files] = await Promise.all([
        fetchAgents().catch(() => [] as AgentInfo[]),
        fetchSkills().catch(() => [] as SkillInfo[]),
        fetchWorkspaceFiles().catch(() => [] as WorkspaceFile[]),
      ]);
      if (cancelled) return;
      graphRef.current = buildGraph(projectName, projectDescription, agents, skills, files);
    }
    loadData();
    return () => { cancelled = true; };
  }, [projectId, projectName, projectDescription]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0, H = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      W = rect.width;
      H = rect.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const initTimer = setTimeout(() => {
      const { nodes, edges } = graphRef.current;
      if (nodes.length === 0) return;

      const cx = W / 2, cy = H / 2;
      const minDim = Math.min(W, H);

      const layers = [
        nodes.filter(n => n.layer === 0),
        nodes.filter(n => n.layer === 1),
        nodes.filter(n => n.layer === 2),
      ];

      layers[0].forEach(n => {
        n.x = cx + (Math.random() - 0.5) * 40;
        n.y = cy + (Math.random() - 0.5) * 40;
      });
      layers[1].forEach((n, i) => {
        const angle = (i / Math.max(1, layers[1].length)) * Math.PI * 2 + Math.random() * 0.5;
        const r = minDim * (0.38 + Math.random() * 0.18);
        n.x = cx + Math.cos(angle) * r;
        n.y = cy + Math.sin(angle) * r;
      });
      layers[2].forEach((n, i) => {
        const angle = (i / Math.max(1, layers[2].length)) * Math.PI * 2 + Math.random() * 0.8;
        const r = minDim * (0.62 + Math.random() * 0.22);
        n.x = cx + Math.cos(angle) * r;
        n.y = cy + Math.sin(angle) * r;
      });

      for (let f = 0; f < 1500; f++) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (1200 * a.mass * b.mass) / (dist * dist);
            a.vx -= (dx / dist) * force / a.mass;
            a.vy -= (dy / dist) * force / a.mass;
            b.vx += (dx / dist) * force / b.mass;
            b.vy += (dy / dist) * force / b.mass;
          }
        }
        edges.forEach(e => {
          const a = nodes.find(n => n.id === e.source);
          const b = nodes.find(n => n.id === e.target);
          if (!a || !b) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 260) * 0.004;
          a.vx += (dx / dist) * force / a.mass;
          a.vy += (dy / dist) * force / a.mass;
          b.vx -= (dx / dist) * force / b.mass;
          b.vy -= (dy / dist) * force / b.mass;
        });
        const pad = 40;
        nodes.forEach(n => {
          if (n.x < pad) n.vx += (pad - n.x) * 0.04;
          if (n.x > W - pad) n.vx -= (n.x - (W - pad)) * 0.04;
          if (n.y < pad) n.vy += (pad - n.y) * 0.04;
          if (n.y > H - pad) n.vy -= (n.y - (H - pad)) * 0.04;
          n.vx *= 0.94; n.vy *= 0.94;
          n.x += n.vx; n.y += n.vy;
        });
      }

      nodes.forEach(n => { n.baseX = n.x; n.baseY = n.y; n.vx = 0; n.vy = 0; });

      const NODE_REPULSE = 300;
      const FLOW_SPRING = 0.002;
      const FLOW_REST = 280;
      const BOUNDARY_K = 0.02;
      const MOTION_DAMP = 0.97;
      const JITTER = 0.025;
      const RETURN_K = 0.004;

      const render = () => {
        const dpr = window.devicePixelRatio || 1;
        const now = Date.now();

        nodes.forEach(n => {
          if (n === draggedNodeRef.current) {
            n.vx = 0; n.vy = 0;
            n.baseX = n.x; n.baseY = n.y;
            return;
          }
          n.vx += (Math.random() - 0.5) * JITTER;
          n.vy += (Math.random() - 0.5) * JITTER;
          n.vx += (n.baseX - n.x) * RETURN_K;
          n.vy += (n.baseY - n.y) * RETURN_K;
        });

        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (NODE_REPULSE * a.mass * b.mass) / (dist * dist);
            a.vx -= (dx / dist) * force / a.mass;
            a.vy -= (dy / dist) * force / a.mass;
            b.vx += (dx / dist) * force / b.mass;
            b.vy += (dy / dist) * force / b.mass;
          }
        }

        edges.forEach(e => {
          const a = nodes.find(n => n.id === e.source);
          const b = nodes.find(n => n.id === e.target);
          if (!a || !b) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - FLOW_REST) * FLOW_SPRING;
          a.vx += (dx / dist) * force / a.mass;
          a.vy += (dy / dist) * force / a.mass;
          b.vx -= (dx / dist) * force / b.mass;
          b.vy -= (dy / dist) * force / b.mass;
        });

        const pad = 45;
        nodes.forEach(n => {
          if (n.x < pad) n.vx += (pad - n.x) * BOUNDARY_K;
          if (n.x > W - pad) n.vx -= (n.x - (W - pad)) * BOUNDARY_K;
          if (n.y < pad) n.vy += (pad - n.y) * BOUNDARY_K;
          if (n.y > H - pad) n.vy -= (n.y - (H - pad)) * BOUNDARY_K;
          n.vx *= MOTION_DAMP; n.vy *= MOTION_DAMP;
          n.x += n.vx; n.y += n.vy;
        });

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        ctx.strokeStyle = '#d4d4d8';
        ctx.lineWidth = 0.7;
        edges.forEach(e => {
          const a = nodes.find(n => n.id === e.source);
          const b = nodes.find(n => n.id === e.target);
          if (!a || !b) return;
          const ax = a.x + Math.sin(now * a.floatSpeed + a.floatPhase) * 0.6;
          const ay = a.y + Math.cos(now * a.floatSpeed * 0.7 + a.floatPhase) * 0.5;
          const bx = b.x + Math.sin(now * b.floatSpeed + b.floatPhase) * 0.6;
          const by = b.y + Math.cos(now * b.floatSpeed * 0.7 + b.floatPhase) * 0.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        });

        nodes.forEach(n => {
          const floatX = Math.sin(now * n.floatSpeed + n.floatPhase) * 0.6;
          const floatY = Math.cos(now * n.floatSpeed * 0.7 + n.floatPhase) * 0.5;
          const rx = n.x + floatX;
          const ry = n.y + floatY;

          ctx.shadowColor = 'rgba(0,0,0,0.06)';
          ctx.shadowBlur = 5;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 1.5;

          ctx.beginPath();
          ctx.arc(rx, ry, n.radius, 0, Math.PI * 2);
          if (hoveredNodeRef.current?.id === n.id) ctx.fillStyle = '#3b82f6';
          else if (draggedNodeRef.current?.id === n.id) ctx.fillStyle = '#2563eb';
          else ctx.fillStyle = '#52525b';
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;

          ctx.fillStyle = hoveredNodeRef.current?.id === n.id ? '#3b82f6' : '#3f3f46';
          ctx.font = '12px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillText(n.label, rx + n.radius + 8, ry + 4);
        });

        animRef.current = requestAnimationFrame(render);
      };

      animRef.current = requestAnimationFrame(render);
    }, 100);

    return () => {
      clearTimeout(initTimer);
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [projectId, projectName, projectDescription]);

  // Canvas mouse interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const posOf = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const hitTest = (x: number, y: number) => {
      const now = Date.now();
      for (const n of graphRef.current.nodes) {
        const fx = Math.sin(now * n.floatSpeed + n.floatPhase) * 0.6;
        const fy = Math.cos(now * n.floatSpeed * 0.7 + n.floatPhase) * 0.5;
        const dx = x - (n.x + fx), dy = y - (n.y + fy);
        if (dx * dx + dy * dy < (n.radius + 8) ** 2) return n;
      }
      return null;
    };

    const onDown = (e: MouseEvent) => {
      const hit = hitTest(posOf(e).x, posOf(e).y);
      if (hit) draggedNodeRef.current = hit;
    };

    const onMove = (e: MouseEvent) => {
      const p = posOf(e);
      if (draggedNodeRef.current) {
        draggedNodeRef.current.x = p.x;
        draggedNodeRef.current.y = p.y;
      }
      const hit = hitTest(p.x, p.y);
      hoveredNodeRef.current = hit;
      canvas.style.cursor = draggedNodeRef.current ? 'grabbing' : hit ? 'pointer' : 'default';

      const tip = tooltipRef.current;
      if (tip) {
        if (hit) {
          const typeLabel = NODE_TYPE_LABELS[hit.type];
          const metaRows = hit.meta
            ? Object.entries(hit.meta).map(([k, v]) => `<div class="flex justify-between text-[10px]"><span class="text-text-muted">${k}</span><span>${v}</span></div>`).join('')
            : '';
          tip.innerHTML = `<div class="text-[10px] text-text-muted mb-0.5">${typeLabel}</div><div class="text-xs font-semibold mb-1">${hit.label}</div><div class="text-[11px] text-text-secondary mb-1">${hit.detail}</div>${metaRows ? `<div class="border-t border-border pt-1 mt-1 space-y-0.5">${metaRows}</div>` : ''}`;
          tip.style.display = 'block';
          const rect = canvas.getBoundingClientRect();
          let tx = p.x + 16, ty = p.y + 16;
          if (tx + 220 > rect.width) tx = p.x - 220;
          if (ty + 140 > rect.height) ty = p.y - 140;
          tip.style.left = tx + 'px';
          tip.style.top = ty + 'px';
        } else {
          tip.style.display = 'none';
        }
      }
    };

    const onUp = () => { draggedNodeRef.current = null; };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col bg-bg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 pt-5 pb-3 shrink-0">
        <h1 className="text-lg font-bold text-text">{projectName}</h1>
        <p className="text-xs text-text-muted mt-1">{projectDescription}</p>
      </div>

      {/* Canvas Graph */}
      <div ref={canvasContainerRef} className="flex-1 min-h-0 relative">
        <canvas ref={canvasRef} className="w-full h-full" />
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none bg-surface border border-border rounded-xl shadow-lg px-3 py-2.5 w-52 z-20"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
