'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  apiFetch, getToken, examPhase, formatDateTime, CodeTestCase, ExamTeacher, QuestionTeacher, QUESTION_TYPE_LABELS, User,
} from '@/lib/api';
import { QuestionForm } from '@/components/teacher/QuestionForm';
import { LiveMonitor } from '@/components/teacher/LiveMonitor';
import { ResultsPanel } from '@/components/teacher/ResultsPanel';

type Tab = 'questions' | 'monitor' | 'results';

function AnswerKeySummary({ q }: { q: QuestionTeacher }) {
  const key = q.answer_key;
  if (q.type === 'essay') return <span className="text-gray-500">Kézi javítás</span>;
  if (q.type === 'short_text') return <span>Elfogadott: {(key as string[]).join(', ')}</span>;
  if (q.type === 'code') {
    const tests = (key as CodeTestCase[]) ?? [];
    return <span>{tests.length} teszteset ({tests.filter((t) => t.public).length} nyilvános)</span>;
  }
  return (
    <ul className="mt-1 space-y-0.5">
      {(q.options ?? []).map((o, i) => (
        <li key={i} className={(key as number[]).includes(i) ? 'text-green-400' : 'text-gray-400'}>
          {(key as number[]).includes(i) ? '✓' : '·'} {o}
        </li>
      ))}
    </ul>
  );
}

export default function TeacherExamPage() {
  const params = useParams();
  const examId = Number(params.id);
  const router = useRouter();
  const [exam, setExam] = useState<ExamTeacher | null>(null);
  const [tab, setTab] = useState<Tab>('questions');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setExam(await apiFetch<ExamTeacher>(`/exams/${examId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba');
    }
  }, [examId]);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    apiFetch<User>('/auth/me').then((u) => {
      if (u.role !== 'teacher') router.replace(`/exam/${examId}`);
      else load();
    });
  }, [router, examId, load]);

  const deleteQuestion = async (q: QuestionTeacher) => {
    if (!window.confirm(`Biztosan törlöd a(z) "${q.title}" feladatot? A rá adott válaszok is törlődnek.`)) return;
    await apiFetch(`/exams/${examId}/questions/${q.id}`, { method: 'DELETE' });
    load();
  };

  const deleteExam = async () => {
    if (!exam || !window.confirm(`Biztosan törlöd a(z) "${exam.title}" vizsgát az összes eredménnyel együtt?`)) return;
    await apiFetch(`/exams/${examId}`, { method: 'DELETE' });
    router.push('/teacher/dashboard');
  };

  if (error) return <div className="min-h-screen flex items-center justify-center text-red-300">{error}</div>;
  if (!exam) return <div className="min-h-screen flex items-center justify-center">Betöltés...</div>;

  const phase = examPhase(exam);
  const tabs: [Tab, string][] = [['questions', `Feladatok (${exam.questions.length})`], ['monitor', 'Élő monitor'], ['results', 'Eredmények']];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 max-w-6xl mx-auto">
      <header className="flex flex-wrap gap-4 justify-between items-start mb-6 pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <p className="text-sm text-gray-400 mt-1">
            {formatDateTime(exam.start_time)} – {formatDateTime(exam.end_time)} · {exam.duration_minutes} perc ·{' '}
            {exam.total_points} pont ·{' '}
            <span className={phase === 'active' ? 'text-green-400' : 'text-gray-400'}>
              {phase === 'upcoming' ? 'még nem kezdődött' : phase === 'active' ? 'folyamatban' : 'lezárult'}
            </span>
          </p>
          {exam.description && <p className="text-sm text-gray-300 mt-1">{exam.description}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push('/teacher/dashboard')} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">
            ← Vizsgák
          </button>
          <button onClick={deleteExam} className="bg-red-600/20 border border-red-500 hover:bg-red-600 px-4 py-2 rounded-lg text-sm">
            Vizsga törlése
          </button>
        </div>
      </header>

      <nav className="flex gap-2 mb-6">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === key ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'questions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-3">
            {exam.questions.length === 0 && <p className="text-gray-400 text-sm">Még nincs feladat. Adj hozzá egyet a jobb oldali űrlappal.</p>}
            {exam.questions.map((q, i) => (
              <div key={q.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-semibold">{i + 1}. {q.title} <span className="text-gray-400 font-normal">({q.points} p)</span></p>
                    <p className="text-xs text-blue-300">{QUESTION_TYPE_LABELS[q.type]}</p>
                  </div>
                  <button onClick={() => deleteQuestion(q)} className="text-gray-400 hover:text-red-400 text-xs">Törlés</button>
                </div>
                <p className="text-gray-300 whitespace-pre-wrap mt-2">{q.description}</p>
                <div className="text-xs mt-2"><AnswerKeySummary q={q} /></div>
              </div>
            ))}
          </div>
          <QuestionForm examId={examId} onCreated={load} />
        </div>
      )}

      {tab === 'monitor' && <LiveMonitor examId={examId} />}
      {tab === 'results' && <ResultsPanel examId={examId} questions={exam.questions} />}
    </div>
  );
}
