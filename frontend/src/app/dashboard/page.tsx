'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken, examPhase, formatDateTime, AttemptSummary, ExamSummary, User } from '@/lib/api';

const PHASE_BADGE = {
  upcoming: { label: 'Hamarosan', cls: 'bg-gray-600' },
  active: { label: 'Elérhető', cls: 'bg-green-600' },
  closed: { label: 'Lezárult', cls: 'bg-red-800' },
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [attempts, setAttempts] = useState<Record<number, AttemptSummary>>({});
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    // Érvénytelen token esetén az apiFetch maga irányít a /login oldalra
    Promise.all([apiFetch<User>('/auth/me'), apiFetch<ExamSummary[]>('/exams/')])
      .then(async ([u, list]) => {
        setUser(u);
        setExams(list);
        if (u.role === 'student') {
          const mine = await apiFetch<AttemptSummary[]>('/attempts/me');
          setAttempts(Object.fromEntries(mine.map((a) => [a.exam_id, a])));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Hálózati hiba – fut a backend?'))
      .finally(() => setIsLoading(false));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex justify-center items-center">
        <p className="text-lg">Betöltés...</p>
      </div>
    );
  }

  const isTeacher = user?.role === 'teacher';
  const visibleExams = isTeacher ? exams.filter((e) => e.created_by === user?.id) : exams;

  const actionFor = (exam: ExamSummary) => {
    if (isTeacher) {
      return { label: 'Kezelés / Eredmények', onClick: () => router.push(`/teacher/exams/${exam.id}`), disabled: false };
    }
    const attempt = attempts[exam.id];
    const phase = examPhase(exam);
    if (attempt?.finished_at) return { label: 'Eredmény megtekintése', onClick: () => router.push(`/exam/${exam.id}`), disabled: false };
    if (attempt) return { label: 'Folytatás', onClick: () => router.push(`/exam/${exam.id}`), disabled: false };
    if (phase === 'active' && exam.question_count > 0) {
      return { label: 'Vizsga indítása', onClick: () => router.push(`/exam/${exam.id}`), disabled: false };
    }
    return { label: phase === 'upcoming' ? 'Még nem kezdődött el' : 'Nem elérhető', onClick: () => {}, disabled: true };
  };

  return (
    <div className="min-h-screen">
      <header className="bg-gray-800 border-b border-gray-700 px-8 py-4 flex flex-wrap gap-4 justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Vizsgarendszer Műszerfal</h1>
          {user && (
            <p className="text-sm text-gray-400">
              Üdvözöllek, {user.full_name} ({isTeacher ? 'Oktató' : 'Hallgató'})
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {isTeacher && (
            <button onClick={() => router.push('/teacher/dashboard')}
              className="bg-purple-600 hover:bg-purple-500 px-4 py-2 rounded-lg text-sm font-semibold transition">
              Oktatói felület
            </button>
          )}
          <button onClick={handleLogout}
            className="bg-red-600/20 border border-red-500 hover:bg-red-600 text-red-200 hover:text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
            Kijelentkezés
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-bold mb-6">{isTeacher ? 'Saját vizsgáim' : 'Vizsgák'}</h2>

        {error && <p className="mb-6 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</p>}

        {visibleExams.length === 0 ? (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-400">
            <p className="text-base">
              {isTeacher ? 'Még nem hoztál létre vizsgát – az Oktatói felületen teheted meg.' : 'Jelenleg nincsenek vizsgák a rendszerben.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {visibleExams.map((exam) => {
              const phase = PHASE_BADGE[examPhase(exam)];
              const attempt = attempts[exam.id];
              const action = actionFor(exam);
              return (
                <div key={exam.id} className="bg-gray-800 border border-gray-700 rounded-xl p-6 flex flex-col justify-between shadow-lg">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h3 className="text-lg font-bold text-blue-400">{exam.title}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${phase.cls}`}>{phase.label}</span>
                    </div>
                    <p className="text-sm text-gray-300 mb-4">{exam.description || 'Nincs megadott leírás.'}</p>

                    <div className="space-y-1 text-xs text-gray-400 mb-4 font-mono">
                      <p>Időtartam: {exam.duration_minutes} perc</p>
                      <p>Feladatok: {exam.question_count} ({exam.total_points} pont)</p>
                      <p>Kezdhető: {formatDateTime(exam.start_time)}</p>
                      <p>Határidő: {formatDateTime(exam.end_time)}</p>
                    </div>

                    {attempt && (
                      <div className="text-sm mb-4 bg-gray-900 border border-gray-700 rounded-lg p-3">
                        {attempt.finished_at ? (
                          <>
                            <span className="font-semibold">Eredmény: {attempt.total_score} / {attempt.max_score} pont</span>
                            {attempt.pending_review > 0 && (
                              <span className="block text-xs text-yellow-300">{attempt.pending_review} feladat javításra vár</span>
                            )}
                          </>
                        ) : (
                          <span className="text-yellow-300">Folyamatban – leadási határidő: {formatDateTime(attempt.deadline)}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <button onClick={action.onClick} disabled={action.disabled}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 font-semibold py-2.5 rounded-lg transition">
                    {action.label}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
