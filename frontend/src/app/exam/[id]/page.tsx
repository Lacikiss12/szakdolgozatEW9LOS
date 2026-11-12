'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  apiFetch, getToken, AnswerResponse, AnswerStudent, AttemptStudent, Question, QUESTION_TYPE_LABELS, User,
} from '@/lib/api';
import { useProctoring } from '@/components/proctoring/useProctoring';
import { AnswerInput, AnswerReadonly } from '@/components/exam/AnswerInput';

const DEFAULT_CODE = '# A bemenetet az input() függvénnyel olvasd, az eredményt print()-tel írd ki\n';
const AUTOSAVE_DELAY_MS = 800;

type SaveState = 'saving' | 'saved' | 'error';

function isAnswered(q: Question, v: AnswerResponse | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return q.type === 'code' ? v.trim() !== '' && v !== DEFAULT_CODE : v.trim() !== '';
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function ExamPage() {
  const params = useParams();
  const examId = params.id as string;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [attempt, setAttempt] = useState<AttemptStudent | null>(null);
  const [notStarted, setNotStarted] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const [activeQ, setActiveQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, AnswerResponse>>({});
  const [saveState, setSaveState] = useState<Record<number, SaveState>>({});
  const [evalOutputs, setEvalOutputs] = useState<Record<number, string>>({});
  const [consoleOut, setConsoleOut] = useState('');
  const [customInput, setCustomInput] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<number, AnswerResponse>>({});
  const clockOffset = useRef(0);
  const finishing = useRef(false);

  const active = !!attempt && !attempt.finished_at;
  const { connected, joinError, violations, notifyFinished } = useProctoring(examId, active, attempt?.violations ?? 0);

  const applyAttempt = useCallback((a: AttemptStudent) => {
    setAttempt(a);
    clockOffset.current = new Date(a.server_time).getTime() - Date.now();
    const ans: Record<number, AnswerResponse> = {};
    const outs: Record<number, string> = {};
    a.answers.forEach((x: AnswerStudent) => {
      ans[x.question_id] = x.response;
      if (x.eval_output) outs[x.question_id] = x.eval_output;
    });
    setAnswers(ans);
    setEvalOutputs(outs);
  }, []);

  // Betöltés: meglévő kitöltés vagy kezdőképernyő
  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    apiFetch<User>('/auth/me')
      .then(async (u) => {
        setUser(u);
        if (u.role === 'teacher') {
          router.replace(`/teacher/exams/${examId}`);
          return;
        }
        try {
          applyAttempt(await apiFetch<AttemptStudent>(`/exams/${examId}/attempt`));
        } catch {
          setNotStarted(true);
        }
      })
      .catch((err) => setLoadError(err.message));
  }, [examId, router, applyAttempt]);

  const startExam = async () => {
    setBusy(true);
    try {
      applyAttempt(await apiFetch<AttemptStudent>(`/exams/${examId}/attempt`, { method: 'POST' }));
      setNotStarted(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Hiba');
    } finally {
      setBusy(false);
    }
  };

  // --- Automatikus mentés ---
  const saveNow = useCallback(async (qid: number) => {
    if (!attempt || !(qid in pending.current)) return;
    const value = pending.current[qid];
    delete pending.current[qid];
    clearTimeout(timers.current[qid]);
    setSaveState((s) => ({ ...s, [qid]: 'saving' }));
    try {
      await apiFetch(`/attempts/${attempt.id}/answers/${qid}`, {
        method: 'PUT',
        body: JSON.stringify({ response: value }),
      });
      setSaveState((s) => ({ ...s, [qid]: 'saved' }));
    } catch {
      setSaveState((s) => ({ ...s, [qid]: 'error' }));
      pending.current[qid] ??= value; // újrapróbálható
    }
  }, [attempt]);

  const flushAll = useCallback(async () => {
    await Promise.all(Object.keys(pending.current).map((k) => saveNow(Number(k))));
  }, [saveNow]);

  const updateAnswer = (qid: number, value: AnswerResponse) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
    pending.current[qid] = value;
    clearTimeout(timers.current[qid]);
    timers.current[qid] = setTimeout(() => saveNow(qid), AUTOSAVE_DELAY_MS);
  };

  // Oldal elhagyásakor figyelmeztetés, ha van mentetlen válasz
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // --- Beadás ---
  const finishExam = useCallback(async (auto = false) => {
    if (!attempt || finishing.current) return;
    if (!auto) {
      const unanswered = attempt.exam.questions.filter((q) => !isAnswered(q, answers[q.id])).length;
      const msg = unanswered > 0
        ? `${unanswered} feladatra még nem válaszoltál. Biztosan beadod? Utána már nem módosíthatsz.`
        : 'Biztosan beadod a vizsgát? Utána már nem módosíthatsz.';
      if (!window.confirm(msg)) return;
    }
    finishing.current = true;
    setBusy(true);
    try {
      await flushAll();
      const res = await apiFetch<AttemptStudent>(`/attempts/${attempt.id}/finish`, { method: 'POST' });
      notifyFinished();
      applyAttempt(res);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Hiba a beadáskor');
    } finally {
      finishing.current = false;
      setBusy(false);
    }
  }, [attempt, answers, flushAll, applyAttempt, notifyFinished]);

  // --- Visszaszámláló; lejáratkor automatikus beadás ---
  useEffect(() => {
    if (!active || !attempt) return;
    const tick = () => {
      const left = new Date(attempt.deadline).getTime() - (Date.now() + clockOffset.current);
      setRemainingMs(left);
      if (left <= 0) finishExam(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [active, attempt, finishExam]);

  // --- Kódfeladat ---
  const question = attempt?.exam.questions[activeQ];
  const code = question && question.type === 'code' ? (answers[question.id] as string | null) ?? DEFAULT_CODE : '';

  const runCode = async () => {
    if (!attempt || !question) return;
    setBusy(true);
    setConsoleOut('Futtatás a Docker sandboxban...');
    try {
      const res = await apiFetch<{ output: string }>(`/attempts/${attempt.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ question_id: question.id, code, custom_input: customInput }),
      });
      setConsoleOut(res.output);
    } catch (err) {
      setConsoleOut(`Hiba: ${err instanceof Error ? err.message : 'ismeretlen'}`);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!attempt || !question) return;
    setBusy(true);
    setConsoleOut('Értékelés az összes tesztesettel...');
    try {
      delete pending.current[question.id];
      clearTimeout(timers.current[question.id]);
      const res = await apiFetch<AnswerStudent>(`/attempts/${attempt.id}/answers/${question.id}/evaluate`, {
        method: 'POST',
        body: JSON.stringify({ response: code }),
      });
      setEvalOutputs((o) => ({ ...o, [question.id]: res.eval_output ?? '' }));
      setSaveState((s) => ({ ...s, [question.id]: 'saved' }));
      setConsoleOut('');
    } catch (err) {
      setConsoleOut(`Hiba: ${err instanceof Error ? err.message : 'ismeretlen'}`);
    } finally {
      setBusy(false);
    }
  };

  // --- Megjelenítés ---
  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col gap-4 items-center justify-center text-red-300 px-4 text-center">
        <p>{loadError}</p>
        <button onClick={() => router.push('/dashboard')} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-white">
          Vissza a műszerfalra
        </button>
      </div>
    );
  }
  if (!user || (!attempt && !notStarted)) {
    return <div className="min-h-screen flex items-center justify-center">Betöltés...</div>;
  }

  if (notStarted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-gray-800 border border-gray-700 rounded-xl p-8 space-y-4">
          <h1 className="text-xl font-bold">Vizsga indítása</h1>
          <ul className="text-sm text-gray-300 list-disc pl-5 space-y-1">
            <li>Az indítás után elindul a visszaszámláló, ami nem állítható meg.</li>
            <li>A válaszaid automatikusan mentődnek; az oldal frissítése után is folytathatod.</li>
            <li>Az ablak- és lapváltásokat a rendszer rögzíti és jelzi az oktatónak.</li>
            <li>Ha lejár az idő, a vizsga automatikusan beadásra kerül.</li>
          </ul>
          <div className="flex gap-3 pt-2">
            <button onClick={startExam} disabled={busy}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2.5 rounded-lg font-semibold">
              {busy ? 'Indítás...' : 'Vizsga indítása'}
            </button>
            <button onClick={() => router.push('/dashboard')} className="bg-gray-700 hover:bg-gray-600 px-4 rounded-lg">
              Mégse
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!attempt) return null;
  const questions = attempt.exam.questions;

  // ---- Eredmény nézet (beadás után) ----
  if (attempt.finished_at) {
    const byQ = Object.fromEntries(attempt.answers.map((a) => [a.question_id, a]));
    return (
      <div className="min-h-screen max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">{attempt.exam.title} – eredmény</h1>
            <p className="text-sm text-gray-400">Beadva: {new Date(attempt.finished_at).toLocaleString('hu-HU')}</p>
          </div>
          <button onClick={() => router.push('/dashboard')} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg">
            Vissza a műszerfalra
          </button>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 flex flex-wrap gap-8 items-center">
          <div>
            <p className="text-sm text-gray-400">Összpontszám</p>
            <p className="text-3xl font-bold">{attempt.total_score} / {attempt.max_score}</p>
          </div>
          {attempt.pending_review > 0 && (
            <p className="text-sm text-yellow-300">
              {attempt.pending_review} feladat oktatói javításra vár – a végleges pontszám ezután alakul ki.
            </p>
          )}
        </div>
        {questions.map((q, i) => {
          const a = byQ[q.id];
          return (
            <div key={q.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
              <div className="flex justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{i + 1}. {q.title}</h2>
                  <p className="text-xs text-gray-500">{QUESTION_TYPE_LABELS[q.type]}</p>
                </div>
                <span className={`text-sm font-bold whitespace-nowrap ${
                  a?.status === 'pending_review' ? 'text-yellow-300' : 'text-blue-300'}`}>
                  {a?.status === 'pending_review' ? 'Javításra vár' : `${a?.score ?? 0} / ${q.points} p`}
                </span>
              </div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{q.description}</p>
              <AnswerReadonly question={q} value={a?.response ?? null} />
              {a?.eval_output && (
                <pre className="text-xs whitespace-pre-wrap bg-gray-900 border border-gray-700 rounded-lg p-3 text-gray-300">
                  {a.eval_output}
                </pre>
              )}
              {a?.feedback && (
                <div className="text-sm bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                  <span className="font-semibold">Oktatói megjegyzés: </span>{a.feedback}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ---- Kitöltés nézet ----
  const lowTime = remainingMs < 5 * 60_000;
  const qState = question ? saveState[question.id] : undefined;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex flex-wrap gap-4 justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-lg">{attempt.exam.title}</h1>
          <p className="text-xs text-yellow-400">Figyelem: Az ablakváltásokat a rendszer rögzíti és jelzi az oktatónak!</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className={`font-mono text-lg font-bold ${lowTime ? 'text-red-400 animate-pulse' : 'text-gray-100'}`}
            title="Hátralévő idő">
            ⏱ {formatRemaining(remainingMs)}
          </span>
          <span className="flex items-center gap-2" title={joinError}>
            <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            {connected ? 'Felügyelet aktív' : 'Nincs kapcsolat'}
          </span>
          <span className={violations > 0 ? 'text-red-400' : 'text-gray-400'}>Ablakváltások: {violations}</span>
          <button onClick={() => finishExam(false)} disabled={busy}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold transition">
            Vizsga beadása
          </button>
        </div>
      </header>

      <nav className="flex gap-2 px-6 pt-4 flex-wrap">
        {questions.map((q, i) => {
          const done = isAnswered(q, answers[q.id]);
          return (
            <button key={q.id} onClick={() => { setActiveQ(i); setConsoleOut(''); setCustomInput(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${
                i === activeQ ? 'bg-blue-600 border-blue-500'
                  : done ? 'bg-green-900/40 border-green-700 hover:bg-green-900/60'
                  : 'bg-gray-800 hover:bg-gray-700 border-gray-700'}`}>
              {i + 1}. {q.title} ({q.points} p) {done && '✓'}
            </button>
          );
        })}
      </nav>

      {question && (
        <div className="mx-6 mt-4 bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm text-gray-200">
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span>{QUESTION_TYPE_LABELS[question.type]} · {question.points} pont</span>
            <span>
              {qState === 'saving' && 'Mentés...'}
              {qState === 'saved' && '✓ Mentve'}
              {qState === 'error' && <span className="text-red-400">Mentési hiba – újrapróbálkozás a következő módosításkor</span>}
            </span>
          </div>
          <p className="whitespace-pre-wrap">{question.description}</p>
          {question.type === 'code' && question.public_tests.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-1">Példa:</p>
              {question.public_tests.map((t, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 text-xs font-mono mb-1">
                  <pre className="bg-gray-900 rounded p-2 whitespace-pre-wrap">Bemenet:{'\n'}{t.input}</pre>
                  <pre className="bg-gray-900 rounded p-2 whitespace-pre-wrap">Várt kimenet:{'\n'}{t.expected_output}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {question && question.type !== 'code' && (
        <div className="mx-6 my-6 bg-gray-800 border border-gray-700 rounded-xl p-6">
          <AnswerInput question={question} value={answers[question.id] ?? null}
            onChange={(v) => updateAnswer(question.id, v)} />
          <div className="flex justify-between mt-6">
            <button disabled={activeQ === 0} onClick={() => setActiveQ(activeQ - 1)}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 px-4 py-2 rounded-lg text-sm">← Előző</button>
            <button disabled={activeQ === questions.length - 1} onClick={() => setActiveQ(activeQ + 1)}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 px-4 py-2 rounded-lg text-sm">Következő →</button>
          </div>
        </div>
      )}

      {question && question.type === 'code' && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-lg">
            <div className="flex flex-wrap gap-2 justify-between items-center mb-3">
              <span className="text-sm font-semibold text-gray-300">Python Kód Szerkesztő</span>
              <div className="flex gap-2">
                <button onClick={runCode} disabled={busy}
                  className="bg-gray-600 hover:bg-gray-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold transition"
                  title="Futtatás a példatesztekkel vagy saját bemenettel – nem pontoz">
                  Próbafuttatás
                </button>
                <button onClick={submitCode} disabled={busy}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold transition"
                  title="Értékelés az összes (rejtett) tesztesettel">
                  {busy ? 'Folyamatban...' : 'Beküldés & értékelés'}
                </button>
              </div>
            </div>
            <textarea value={code} spellCheck={false} rows={18}
              onChange={(e) => updateAnswer(question.id, e.target.value)}
              onKeyDown={(e) => {
                // Tab billentyű behúzásként működjön
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const t = e.currentTarget;
                  const { selectionStart: s, selectionEnd: end } = t;
                  updateAnswer(question.id, code.slice(0, s) + '    ' + code.slice(end));
                  requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
                }
              }}
              className="w-full flex-1 bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm text-green-300 focus:outline-none focus:border-blue-500 transition resize-none" />
            <label className="flex items-center gap-2 text-xs text-gray-400 mt-3">
              <input type="checkbox" checked={customInput !== null}
                onChange={(e) => setCustomInput(e.target.checked ? '' : null)} />
              Próbafuttatás saját bemenettel
            </label>
            {customInput !== null && (
              <textarea value={customInput} rows={3} placeholder="Saját bemenet (stdin)"
                onChange={(e) => setCustomInput(e.target.value)}
                className="mt-2 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 font-mono text-xs focus:outline-none focus:border-blue-500" />
            )}
          </div>

          <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-lg gap-3">
            <span className="text-sm font-semibold text-gray-300">Konzol</span>
            <pre className="w-full min-h-[8rem] bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-300 overflow-auto whitespace-pre-wrap">
              {consoleOut || 'A próbafuttatás kimenete itt jelenik meg...'}
            </pre>
            <span className="text-sm font-semibold text-gray-300">Utolsó beküldés értékelése</span>
            <pre className="w-full flex-1 min-h-[8rem] bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-300 overflow-auto whitespace-pre-wrap">
              {evalOutputs[question.id] || 'Még nem küldtél be megoldást. Beadáskor a legutóbb mentett kód kerül értékelésre.'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
