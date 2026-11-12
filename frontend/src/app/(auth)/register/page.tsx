'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', invite_code: '' });
  const [isTeacher, setIsTeacher] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = { ...form, invite_code: isTeacher ? form.invite_code : null };
      await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(body) });
      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hálózati hiba – fut a backend?');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500';

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-xl p-8 space-y-4 shadow-lg">
        <h1 className="text-2xl font-bold text-center">Regisztráció</h1>
        {error && <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</p>}
        <input required placeholder="Teljes név" value={form.full_name} onChange={update('full_name')} className={inputCls} />
        <input type="email" required placeholder="E-mail cím" value={form.email} onChange={update('email')} className={inputCls} />
        <input type="password" required minLength={4} placeholder="Jelszó (min. 4 karakter)" value={form.password} onChange={update('password')} className={inputCls} />
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={isTeacher} onChange={(e) => setIsTeacher(e.target.checked)} />
          Oktatóként regisztrálok
        </label>
        {isTeacher && (
          <input required placeholder="Oktatói meghívókód" value={form.invite_code} onChange={update('invite_code')}
            className={inputCls} />
        )}
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2.5 rounded-lg font-semibold transition">
          {loading ? 'Regisztráció...' : 'Regisztráció'}
        </button>
        <p className="text-sm text-center text-gray-400">
          Van már fiókod? <Link href="/login" className="text-blue-400 hover:underline">Bejelentkezés</Link>
        </p>
      </form>
    </div>
  );
}
