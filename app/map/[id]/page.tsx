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
  const { onChange, onAdd } = data as {
    onChange?: (id: string, v: string) => void;
    onAdd?: (id: string) => void;
  };
  return (
    <div className="mm-node">
      <Handle type="target" position={Position.Left} />
      <span className="grab" title="Drag to move">
        ⠿
      </span>
      <input
        className="nodrag"
        onFocus={(e) => e.currentTarget.select()}
        value={(data as { label: string }).label}
        onChange={(e) => onChange?.(id, e.target.value)}
      />
      <button
        className="nodrag add"
        title="Add child"
        onClick={() => onAdd?.(id)}
      >
        +
      </button>
      <Handle type="source" position={Position.Right} />
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
    data: { label: (n.data as { label: string }).label },
  }));
const cleanEdges = (edges: Edge[]) =>
  edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

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

  const onLabelChange = useCallback(
    (nodeId: string, label: string) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, label } } : n,
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
    (c: Connection) => setEdges((es) => addEdge(c, es)),
    [setEdges],
  );

  const addNode = (parentId?: string) => {
    const selected =
      nodes.find((n) => n.id === parentId) ??
      nodes.find((n) => n.selected) ??
      nodes[0];
    const newId = crypto.randomUUID();
    const base = selected?.position ?? { x: 0, y: 0 };
    const siblings = edges.filter((e) => e.source === selected?.id).length;
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id: newId,
        type: "editable",
        position: { x: base.x + 250, y: base.y + siblings * 70 },
        data: { label: "New idea" },
        selected: true,
      },
    ]);
    if (selected)
      setEdges((es) => [
        ...es,
        { id: crypto.randomUUID(), source: selected.id, target: newId },
      ]);
  };

  const displayNodes = nodes.map((n) => ({
    ...n,
    dragHandle: ".grab",
    data: { ...n.data, onChange: onLabelChange, onAdd: addNode },
  }));

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
        <span className="status">{saving ? "Saving…" : "Saved"}</span>
      </header>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
