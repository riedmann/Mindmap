"use client";

import { useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <form
      className="card login"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => signInWithEmailAndPassword(auth, email, password));
      }}
    >
      <h1>Mindmaps</h1>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
      />
      <button type="submit">Sign in</button>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          run(() => createUserWithEmailAndPassword(auth, email, password))
        }
      >
        Create account
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          run(() => signInWithPopup(auth, new GoogleAuthProvider()))
        }
      >
        Continue with Google
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
