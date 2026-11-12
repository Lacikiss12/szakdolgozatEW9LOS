'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken, examPhase, formatDateTime, ExamSummary, ExamTeacher, User } from '@/lib/api';
import { inputCls } from '@/components/teacher/QuestionForm';

/** Date -> a <input type="datetime-local"> által várt helyi idő formátum */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyForm = () => {
  const now = new Date();
  return {
    title: '',
    description: '',
    duration_minutes: 60,
    start: toLocalInput(now),
    end: toLocalInput(new Date(now.getTime() + 2 * 3600_000)),
  };
};

export default function TeacherDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState('');

  const loadExams = useCallback(async (me: User) => {
    const list = await apiFetch<ExamSummary[]>('/exams/');
    setExams(list.filter((e) => e.created_by === me.id));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    apiFetch<User>('/auth/me')
      .then((u) => {
        if (u.role !== 'teacher') return router.push('/dashboard');
        setUser(u);
        return loadExams(u);
      })
      .catch((err) => setMsg(err.message));
  }, [router, loadExams]);

  const createExam = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const exam = await apiFetch<ExamTeacher>('/exams/', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          duration_minutes: form.duration_minutes,
          start_time: new Date(form.start).toISOString(),
          end_time: new Date(form.end).toISOString(),
        }),
      });
      router.push(`/teacher/exams/${exam.id}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Hiba');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 max-w-6xl mx-auto">
      <header className="flex flex-wrap gap-4 justify-between items-center mb-8 pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-2xl font-bold">Oktatói felület</h1>
          {user && <p className="text-sm text-gray-400">{user.full_name}</p>}
        </div>
        <button onClick={() => router.push('/dashboard')}
          className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition">
          Műszerfal
        </button>
      </header>

      {msg && <p className="mb-6 text-sm bg-blue-900/30 border border-blue-700 rounded p-2">{msg}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_24rem] gap-6 items-start">
        <section>
          <h2 className="text-lg font-semibold mb-4">Vizsgáim</h2>
          {exams.length === 0 ? (
            <p className="text-gray-400 text-sm">Még nincs vizsgád – hozz létre egyet!</p>
          ) : (
            <div className="space-y-3">
              {exams.map((x) => {
                const phase = examPhase(x);
                return (
                  <button key={x.id} onClick={() => router.push(`/teacher/exams/${x.id}`)}
                    className="w-full text-left bg-gray-800 border border-gray-700 hover:border-blue-500 rounded-xl p-4 transition">
                    <div className="flex justify-between gap-4">
                      <span className="font-semibold text-blue-300">{x.title}</span>
                      <span className={`text-xs ${phase === 'active' ? 'text-green-400' : 'text-gray-400'}`}>
                        {phase === 'upcoming' ? 'Hamarosan' : phase === 'active' ? 'Folyamatban' : 'Lezárult'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDateTime(x.start_time)} – {formatDateTime(x.end_time)} · {x.duration_minutes} perc ·{' '}
                      {x.question_count} feladat · {x.total_points} pont
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <form onSubmit={createExam} className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-3">
          <h2 className="text-lg font-semibold">Új vizsga</h2>
          <input required placeholder="Cím" value={form.title} className={inputCls}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea placeholder="Leírás (opcionális)" rows={2} value={form.description} className={inputCls}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="block text-sm text-gray-400">
            Kezdhető ettől
            <input type="datetime-local" required value={form.start} className={`${inputCls} mt-1`}
              onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </label>
          <label className="block text-sm text-gray-400">
            Határidő (eddig kell beadni)
            <input type="datetime-local" required value={form.end} className={`${inputCls} mt-1`}
              onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </label>
          <label className="block text-sm text-gray-400">
            Kitöltési idő (perc) – a kezdéstől számítva, de legfeljebb a határidőig
            <input type="number" min={1} required value={form.duration_minutes} className={`${inputCls} mt-1`}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
          </label>
          <button className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold">Létrehozás</button>
        </form>
      </div>
    </div>
  );
}
