import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  idToken: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  getFreshToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          setIdToken(token);
        } catch {
          setIdToken(null);
        }
      } else {
        setIdToken(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleAuthProvider);
    const token = await result.user.getIdToken();
    setIdToken(token);
  };

  const logout = async () => {
    await signOut(auth);
    setIdToken(null);
  };

  const getFreshToken = async () => {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    setIdToken(token);
    return token;
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, idToken, signInWithGoogle, logout, getFreshToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
