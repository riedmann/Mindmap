"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";

function EditableNode({ id, data }: NodeProps) {
  const { onChange, onAdd, onToggle, onDelete, hasChildren, collapsed } =
    data as {
      onChange?: (id: string, v: string) => void;
      onAdd?: (id: string) => void;
      onToggle?: (id: string) => void;
      onDelete?: (id: string) => void;
      hasChildren?: boolean;
      collapsed?: boolean;
    };
  return (
    <div className="mm-node">
      <Handle id="tl" type="target" position={Position.Left} />
      <Handle id="sl" type="source" position={Position.Left} />
      <span className="grab" title="Drag to move">
        ⠿
      </span>
      <button
        className="nodrag add"
        title="Add child"
        onClick={() => onAdd?.(id)}
      >
        +
      </button>
      <input
        className="nodrag"
        onFocus={(e) => e.currentTarget.select()}
        value={(data as { label: string }).label}
        onChange={(e) => onChange?.(id, e.target.value)}
      />
      {hasChildren && (
        <button
          className="nodrag secondary toggle"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => onToggle?.(id)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      )}
      <button
        className="nodrag secondary toggle"
        title="Delete"
        onClick={() => onDelete?.(id)}
      >
        🗑
      </button>
      <Handle id="sr" type="source" position={Position.Right} />
      <Handle id="tr" type="target" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { editable: EditableNode };

// Strip runtime-only fields before saving to Firestore
const clean = (nodes: Node[]) =>
  nodes.map((n) => ({
    id: n.id,
    type: "editable",
    position: n.position,
    data: {
      label: (n.data as { label: string }).label,
      ...((n.data as { collapsed?: boolean }).collapsed && { collapsed: true }),
    },
  }));
const cleanEdges = (edges: Edge[]) =>
  edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle && { sourceHandle: e.sourceHandle }),
    ...(e.targetHandle && { targetHandle: e.targetHandle }),
  }));

export default function MapPage() {
  return (
    <Suspense fallback={<main className="center">Loading…</main>}>
      <MapEditor />
    </Suspense>
  );
}

function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flow = useRef<{
    fitView: (o?: { duration: number }) => unknown;
  } | null>(null);

  const onLabelChange = useCallback(
    (nodeId: string, label: string) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, label } } : n,
        ),
      ),
    [setNodes],
  );

  const onToggle = useCallback(
    (nodeId: string) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } }
            : n,
        ),
      ),
    [setNodes],
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    getDoc(doc(db, "mindmaps", id))
      .then((snap) => {
        if (!snap.exists() || snap.data().ownerId !== user.uid) {
          router.replace("/");
          return;
        }
        const d = snap.data();
        setTitle(d.title);
        setNodes(d.nodes);
        setEdges(d.edges);
        setReady(true);
      })
      .catch(() => router.replace("/"));
  }, [id, user, loading, router, setNodes, setEdges]);

  // Debounced autosave
  useEffect(() => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      await updateDoc(doc(db, "mindmaps", id), {
        title,
        nodes: clean(nodes),
        edges: cleanEdges(edges),
        updatedAt: serverTimestamp(),
      });
      setSaving(false);
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [nodes, edges, title, ready, id]);

  const onConnect = useCallback(
    (c: Connection) =>
      c.source !== c.target && setEdges((es) => addEdge(c, es)),
    [setEdges],
  );

  const addNode = (parentId?: string) => {
    const selected =
      nodes.find((n) => n.id === parentId) ??
      nodes.find((n) => n.selected) ??
      nodes[0];
    const newId = crypto.randomUUID();
    const base = selected?.position ?? { x: 0, y: 0 };
    const kids = edges.filter(
      (e) => e.source === selected?.id && e.target !== selected?.id,
    );
    const siblings = kids.length;

    // Follow the parent's side of the root; a root alternates sides
    let root = selected;
    for (let i = 0; root && i < nodes.length; i++) {
      const up = edges.find(
        (e) => e.target === root!.id && e.source !== root!.id,
      );
      const parent = up && nodes.find((n) => n.id === up.source);
      if (!parent) break;
      root = parent;
    }
    let dir = 1;
    if (selected && root && selected.id !== root.id) {
      dir = selected.position.x < root.position.x ? -1 : 1;
    } else if (selected) {
      const left = kids.filter(
        (e) =>
          (nodes.find((n) => n.id === e.target)?.position.x ?? 0) <
          selected.position.x,
      ).length;
      dir = siblings - left > left ? -1 : 1;
    }
    setNodes((ns) => [
      ...ns.map((n) => ({
        ...n,
        selected: false,
        ...(n.id === selected?.id && { data: { ...n.data, collapsed: false } }),
      })),
      {
        id: newId,
        type: "editable",
        position: { x: base.x + dir * 340, y: base.y + siblings * 80 },
        data: { label: "New idea" },
        selected: true,
      },
    ]);
    if (selected)
      setEdges((es) => [
        ...es,
        {
          id: crypto.randomUUID(),
          source: selected.id,
          target: newId,
          sourceHandle: dir === 1 ? "sr" : "sl",
          targetHandle: dir === 1 ? "tl" : "tr",
        },
      ]);
  };

  const deleteNode = (nodeId: string) => {
    // Removing a node also removes everything below it
    const gone = new Set([nodeId]);
    for (let grew = true; grew; ) {
      grew = false;
      edges.forEach((e) => {
        if (gone.has(e.source) && !gone.has(e.target)) {
          gone.add(e.target);
          grew = true;
        }
      });
    }
    if (
      gone.size > 1 &&
      !confirm(`Delete this node and ${gone.size - 1} below it?`)
    )
      return;
    setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
    setEdges((es) =>
      es.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    );
  };

  const autoLayout = () => {
    // Self-loops make a node its own parent, which hides the real root
    const tree = edges.filter((e) => e.source !== e.target);
    const children = new Map<string, string[]>();
    tree.forEach((e) =>
      children.set(e.source, [...(children.get(e.source) ?? []), e.target]),
    );
    const hasParent = new Set(tree.map((e) => e.target));
    const pos = new Map<string, { x: number; y: number }>();
    const seen = new Set<string>();
    let cursor = 0;

    // Root in the center, its children split between the right and left side
    const layoutRoot = (rootId: string) => {
      seen.add(rootId);
      const group = new Map<string, { x: number; y: number }>([
        [rootId, { x: 0, y: 0 }],
      ]);
      const top = [...new Set(children.get(rootId) ?? [])].filter(
        (k) => !seen.has(k),
      );
      const half = Math.ceil(top.length / 2);
      const sides: [string[], number][] = [
        [top.slice(0, half), 1],
        [top.slice(half), -1],
      ];
      for (const [list, dir] of sides) {
        let row = 0;
        const local = new Map<string, { x: number; y: number }>();
        const place = (nid: string, depth: number): number => {
          seen.add(nid);
          const ks = (children.get(nid) ?? []).filter((k) => !seen.has(k));
          const ys = ks.map((k) => place(k, depth + 1));
          const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++ * 80;
          // Extra gap after a branch so sibling subtrees stay visually separate
          if (ys.length) row += 0.6;
          local.set(nid, { x: dir * depth * 340, y });
          return y;
        };
        const tops = list.filter((k) => !seen.has(k)).map((k) => place(k, 1));
        if (!tops.length) continue;
        const shift = -(tops[0] + tops[tops.length - 1]) / 2;
        local.forEach((p, nid) => group.set(nid, { x: p.x, y: p.y + shift }));
      }
      const ys = [...group.values()].map((p) => p.y);
      const off = cursor - Math.min(...ys);
      group.forEach((p, nid) => pos.set(nid, { x: p.x, y: p.y + off }));
      cursor = Math.max(...ys) + off + 120;
    };

    nodes.filter((n) => !hasParent.has(n.id)).forEach((n) => layoutRoot(n.id));
    nodes.filter((n) => !seen.has(n.id)).forEach((n) => layoutRoot(n.id));

    const laidOut = tree.map((e) => {
      const right = (pos.get(e.target)?.x ?? 0) >= (pos.get(e.source)?.x ?? 0);
      return {
        ...e,
        sourceHandle: right ? "sr" : "sl",
        targetHandle: right ? "tl" : "tr",
      };
    });
    setEdges(laidOut);
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id)! })));
    setTimeout(() => flow.current?.fitView({ duration: 300 }), 50);
  };

  // Everything below a collapsed node is hidden
  const hidden = new Set<string>();
  const kidsOf = new Map<string, string[]>();
  edges.forEach((e) => {
    if (e.source !== e.target)
      kidsOf.set(e.source, [...(kidsOf.get(e.source) ?? []), e.target]);
  });
  const hide = (nid: string) =>
    (kidsOf.get(nid) ?? []).forEach((k) => {
      if (hidden.has(k)) return;
      hidden.add(k);
      hide(k);
    });
  nodes.forEach((n) => n.data.collapsed && hide(n.id));

  const displayNodes = nodes.map((n) => ({
    ...n,
    hidden: hidden.has(n.id),
    dragHandle: ".grab",
    data: {
      ...n.data,
      onChange: onLabelChange,
      onAdd: addNode,
      onToggle,
      onDelete: deleteNode,
      hasChildren: kidsOf.has(n.id),
    },
  }));
  const displayEdges = edges.map((e) => ({
    ...e,
    hidden: hidden.has(e.source) || hidden.has(e.target),
  }));

  // Dropping a node onto another makes it a child of that node
  const onNodeDragStop = (_: unknown, dragged: Node) => {
    const below = new Set<string>();
    const walk = (x: string) =>
      (kidsOf.get(x) ?? []).forEach((k) => {
        if (below.has(k)) return;
        below.add(k);
        walk(k);
      });
    walk(dragged.id);

    const cx = dragged.position.x + (dragged.measured?.width ?? 230) / 2;
    const cy = dragged.position.y + (dragged.measured?.height ?? 45) / 2;
    const target = nodes.find(
      (n) =>
        n.id !== dragged.id &&
        !hidden.has(n.id) &&
        !below.has(n.id) &&
        cx >= n.position.x &&
        cx <= n.position.x + (n.measured?.width ?? 230) &&
        cy >= n.position.y &&
        cy <= n.position.y + (n.measured?.height ?? 45),
    );
    if (!target) return;

    const dir = dragged.position.x >= target.position.x ? 1 : -1;
    const siblings = (kidsOf.get(target.id) ?? []).filter(
      (k) => k !== dragged.id,
    ).length;
    const dx = target.position.x + dir * 340 - dragged.position.x;
    const dy = target.position.y + siblings * 80 - dragged.position.y;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === dragged.id || below.has(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n,
      ),
    );
    setEdges((es) => [
      ...es.filter((e) => e.target !== dragged.id),
      {
        id: crypto.randomUUID(),
        source: target.id,
        target: dragged.id,
        sourceHandle: dir === 1 ? "sr" : "sl",
        targetHandle: dir === 1 ? "tl" : "tr",
      },
    ]);
  };

  if (!ready) return <main className="center">Loading…</main>;

  return (
    <div className="editor">
      <header>
        <Link href="/">← Back</Link>
        <input
          className="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button onClick={() => addNode()}>+ Add child</button>
        <button className="secondary" onClick={autoLayout}>
          Auto layout
        </button>
        <span className="status">{saving ? "Saving…" : "Saved"}</span>
      </header>
      <ReactFlow
        onInit={(i) => (flow.current = i)}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
