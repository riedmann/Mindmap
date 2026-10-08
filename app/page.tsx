"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import LoginForm from "@/components/LoginForm";

type MapItem = { id: string; title: string };

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [maps, setMaps] = useState<MapItem[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "mindmaps"),
      where("ownerId", "==", user.uid),
    );
    return onSnapshot(q, (snap) =>
      setMaps(
        snap.docs
          .map((d) => ({
            id: d.id,
            title: d.data().title,
            // Pending server timestamps are null locally; treat them as newest
            updated: d.data().updatedAt?.toMillis() ?? Date.now(),
          }))
          .sort((a, b) => b.updated - a.updated),
      ),
    );
  }, [user]);

  if (loading) return <main className="center">Loading…</main>;
  if (!user)
    return (
      <main className="center">
        <LoginForm />
      </main>
    );

  const create = async () => {
    const ref = await addDoc(collection(db, "mindmaps"), {
      ownerId: user.uid,
      title: "Untitled",
      nodes: [
        {
          id: "root",
          type: "editable",
          position: { x: 0, y: 0 },
          data: { label: "Central idea" },
        },
      ],
      edges: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    router.push(`/map/${ref.id}`);
  };

  return (
    <main className="list">
      <header>
        <h1>My mindmaps</h1>
        <span>
          {user.email}{" "}
          <button className="secondary" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </span>
      </header>
      <button onClick={create}>+ New mindmap</button>
      <ul>
        {maps.map((m) => (
          <li key={m.id} className="card">
            <Link href={`/map/${m.id}`}>{m.title || "Untitled"}</Link>
            <button
              className="secondary"
              onClick={() =>
                confirm("Delete this mindmap?") &&
                deleteDoc(doc(db, "mindmaps", m.id))
              }
            >
              Delete
            </button>
          </li>
        ))}
        {maps.length === 0 && <p>No mindmaps yet.</p>}
      </ul>
    </main>
  );
}
