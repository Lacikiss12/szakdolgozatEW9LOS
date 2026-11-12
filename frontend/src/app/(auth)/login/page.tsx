'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // A FastAPI OAuth2 végpont form-urlencoded adatot vár (username = e-mail)
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Sikertelen bejelentkezés');
      localStorage.setItem('token', data.access_token);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hálózati hiba – fut a backend?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-xl p-8 space-y-4 shadow-lg">
        <h1 className="text-2xl font-bold text-center">Bejelentkezés</h1>
        {error && <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</p>}
        <input type="email" required placeholder="E-mail cím" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
        <input type="password" required placeholder="Jelszó" value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2.5 rounded-lg font-semibold transition">
          {loading ? 'Belépés...' : 'Belépés'}
        </button>
        <p className="text-sm text-center text-gray-400">
          Nincs fiókod? <Link href="/register" className="text-blue-400 hover:underline">Regisztráció</Link>
        </p>
      </form>
    </div>
  );
}
