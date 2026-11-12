'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  apiDownload, apiFetch, formatDateTime, AnswerTeacher, AttemptTeacher, QuestionTeacher, QUESTION_TYPE_LABELS,
} from '@/lib/api';
import { AnswerReadonly } from '@/components/exam/AnswerInput';
import { inputCls } from '@/components/teacher/QuestionForm';

function GradeForm({ answer, question, onSaved }: { answer: AnswerTeacher; question: QuestionTeacher; onSaved: () => void }) {
  const [score, setScore] = useState(answer.manual_score?.toString() ?? '');
  const [feedback, setFeedback] = useState(answer.feedback ?? '');
  const [msg, setMsg] = useState('');

  const save = async () => {
    setMsg('');
    try {
      await apiFetch(`/answers/${answer.id}/grade`, {
        method: 'PATCH',
        body: JSON.stringify({ manual_score: score === '' ? null : Number(score), feedback: feedback || null }),
      });
      setMsg('Mentve');
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Hiba');
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2 mt-2">
      <label className="text-xs text-gray-400">
        Kézi pont (0–{question.points})
        <input type="number" min={0} max={question.points} value={score} placeholder={answer.auto_score?.toString() ?? '-'}
          onChange={(e) => setScore(e.target.value)} className={`${inputCls} w-28 mt-1`} />
      </label>
      <label className="text-xs text-gray-400 flex-1 min-w-[12rem]">
        Visszajelzés a hallgatónak
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} className={`${inputCls} mt-1`} />
      </label>
      <button onClick={save} className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg text-sm font-semibold">Mentés</button>
      {msg && <span className="text-xs text-gray-300">{msg}</span>}
    </div>
  );
}

export function ResultsPanel({ examId, questions }: { examId: number; questions: QuestionTeacher[] }) {
  const [results, setResults] = useState<AttemptTeacher[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setResults(await apiFetch<AttemptTeacher[]>(`/exams/${examId}/results`));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Hiba');
    }
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  const regrade = async () => {
    const res = await apiFetch<{ regraded: number }>(`/exams/${examId}/regrade`, { method: 'POST' });
    setMsg(`${res.regraded} válasz újraértékelve.`);
    load();
  };

  const totalPending = results.reduce((s, r) => s + r.pending_review, 0);
  const finished = results.filter((r) => r.finished_at);
  const avg = finished.length ? finished.reduce((s, r) => s + r.total_score, 0) / finished.length : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <button onClick={load} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">Frissítés</button>
        <button onClick={() => apiDownload(`/exams/${examId}/results.csv`, `vizsga_${examId}_eredmenyek.csv`)}
          className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">CSV export</button>
        <button onClick={regrade} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm"
          title="A lezárt kitöltések még nem értékelt (pl. Docker-hiba miatt) válaszainak újraértékelése">
          Újraértékelés
        </button>
        <span className="text-sm text-gray-400">
          {results.length} kitöltés · {finished.length} beadva · átlag: {avg.toFixed(1)} p
          {totalPending > 0 && <span className="text-yellow-300"> · {totalPending} válasz javításra vár</span>}
        </span>
      </div>
      {msg && <p className="text-sm bg-blue-900/30 border border-blue-700 rounded p-2">{msg}</p>}

      {results.length === 0 ? (
        <p className="text-gray-400 text-sm">Még senki nem kezdte el a vizsgát.</p>
      ) : (
        <div className="space-y-2">
          {results.map((r) => {
            const byQ = Object.fromEntries(r.answers.map((a) => [a.question_id, a]));
            return (
              <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-xl">
                <button onClick={() => setOpen(open === r.id ? null : r.id)}
                  className="w-full flex flex-wrap gap-4 justify-between items-center p-4 text-left hover:bg-gray-700/40 rounded-xl">
                  <div>
                    <p className="font-semibold">{r.user.full_name} <span className="text-xs text-gray-400">{r.user.email}</span></p>
                    <p className="text-xs text-gray-400">
                      Kezdés: {formatDateTime(r.started_at)} · {r.finished_at ? `Beadva: ${formatDateTime(r.finished_at)}` : 'folyamatban'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {r.violations > 0 && <span className="text-red-400">{r.violations} ablakváltás</span>}
                    {r.pending_review > 0 && <span className="text-yellow-300">{r.pending_review} javítandó</span>}
                    <span className="font-bold">{r.total_score} / {r.max_score} p</span>
                    <span className="text-gray-400">{open === r.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {open === r.id && (
                  <div className="border-t border-gray-700 p-4 space-y-4">
                    {questions.map((q, i) => {
                      const a = byQ[q.id];
                      const correct = Array.isArray(q.answer_key) && q.answer_key.every((x) => typeof x === 'number')
                        ? (q.answer_key as number[]) : undefined;
                      return (
                        <div key={q.id} className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                          <div className="flex justify-between gap-4 mb-2">
                            <div>
                              <p className="font-semibold text-sm">{i + 1}. {q.title}</p>
                              <p className="text-xs text-gray-500">{QUESTION_TYPE_LABELS[q.type]}</p>
                            </div>
                            <span className={`text-sm font-bold whitespace-nowrap ${
                              a?.status === 'pending_review' ? 'text-yellow-300' : a?.status === 'not_graded' ? 'text-gray-400' : 'text-blue-300'}`}>
                              {a?.status === 'pending_review' ? 'Javításra vár'
                                : a?.status === 'not_graded' ? 'Nincs értékelve'
                                : `${a?.score ?? 0} / ${q.points} p`}
                              {a?.manual_score != null && <span className="text-xs text-gray-400"> (kézi)</span>}
                            </span>
                          </div>
                          <AnswerReadonly question={q} value={a?.response ?? null} correct={correct} />
                          {q.type === 'short_text' && Array.isArray(q.answer_key) && (
                            <p className="text-xs text-green-400 mt-1">Elfogadott: {(q.answer_key as string[]).join(', ')}</p>
                          )}
                          {a?.eval_output && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-400 cursor-pointer">Kódértékelés részletei</summary>
                              <pre className="text-xs whitespace-pre-wrap bg-gray-900 border border-gray-700 rounded p-2 mt-1">{a.eval_output}</pre>
                            </details>
                          )}
                          {a && <GradeForm key={`${a.id}-${a.manual_score}-${a.feedback}`} answer={a} question={q} onSaved={load} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
