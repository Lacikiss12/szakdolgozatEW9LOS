'use client';

import { FormEvent, useState } from 'react';
import { apiFetch, CodeTestCase, QuestionType, QUESTION_TYPE_LABELS } from '@/lib/api';

export const inputCls =
  'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500';

const emptyTest = (isPublic = false): CodeTestCase => ({ input: '', expected_output: '', public: isPublic });

interface FormState {
  type: QuestionType;
  title: string;
  description: string;
  points: number;
  options: string[];
  correct: number[];
  accepted: string;
  tests: CodeTestCase[];
}

const initialState = (type: QuestionType = 'single_choice'): FormState => ({
  type,
  title: '',
  description: '',
  points: type === 'code' || type === 'essay' ? 10 : 2,
  options: ['', '', '', ''],
  correct: [],
  accepted: '',
  tests: [emptyTest(true), emptyTest()],
});

export function QuestionForm({ examId, onCreated }: { examId: number; onCreated: () => void }) {
  const [f, setF] = useState<FormState>(initialState());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((s) => ({ ...s, [key]: value }));

  const changeType = (type: QuestionType) =>
    setF((s) => ({ ...initialState(type), title: s.title, description: s.description }));

  const toggleCorrect = (i: number) => {
    if (f.type === 'multiple_choice') {
      set('correct', f.correct.includes(i) ? f.correct.filter((x) => x !== i) : [...f.correct, i]);
    } else {
      set('correct', [i]);
    }
  };

  const removeOption = (i: number) => {
    set('options', f.options.filter((_, j) => j !== i));
    set('correct', f.correct.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
  };

  const buildPayload = () => {
    const base = { type: f.type, title: f.title, description: f.description, points: f.points };
    switch (f.type) {
      case 'single_choice':
      case 'multiple_choice': {
        // Az üres válaszlehetőségeket kihagyjuk, a helyes indexeket ennek megfelelően újraszámoljuk
        const kept = f.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
        return {
          ...base,
          options: kept.map((x) => x.o),
          answer_key: kept.map((x, newIdx) => (f.correct.includes(x.i) ? newIdx : -1)).filter((x) => x >= 0),
        };
      }
      case 'true_false':
        return { ...base, answer_key: f.correct };
      case 'short_text':
        return { ...base, answer_key: f.accepted.split('\n').map((s) => s.trim()).filter(Boolean) };
      case 'code':
        return { ...base, answer_key: f.tests.filter((t) => t.input.trim() || t.expected_output.trim()) };
      default:
        return base;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (['single_choice', 'multiple_choice', 'true_false'].includes(f.type) && f.correct.length === 0) {
      return setError('Jelöld meg a helyes választ.');
    }
    setSaving(true);
    try {
      await apiFetch(`/exams/${examId}/questions`, { method: 'POST', body: JSON.stringify(buildPayload()) });
      setF(initialState(f.type));
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const isChoice = f.type === 'single_choice' || f.type === 'multiple_choice';

  return (
    <form onSubmit={submit} className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold">Új feladat</h2>
      {error && <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block text-sm text-gray-400 sm:col-span-2">
          Típus
          <select value={f.type} onChange={(e) => changeType(e.target.value as QuestionType)} className={`${inputCls} mt-1`}>
            {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
              <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-gray-400">
          Pontszám
          <input type="number" min={1} value={f.points} className={`${inputCls} mt-1`}
            onChange={(e) => set('points', Number(e.target.value))} />
        </label>
      </div>

      <input required placeholder="Feladat címe" value={f.title} className={inputCls}
        onChange={(e) => set('title', e.target.value)} />
      <textarea required placeholder={f.type === 'true_false' ? 'Állítás, amiről el kell dönteni, igaz-e' : 'Feladat szövege / kérdés'}
        rows={4} value={f.description} className={inputCls} onChange={(e) => set('description', e.target.value)} />

      {isChoice && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">
            Válaszlehetőségek – jelöld be a helyes{f.type === 'multiple_choice' ? 'eket' : 'et'}:
          </p>
          {f.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type={f.type === 'multiple_choice' ? 'checkbox' : 'radio'} name="correct" title="Helyes válasz"
                checked={f.correct.includes(i)} onChange={() => toggleCorrect(i)} />
              <input placeholder={`${i + 1}. válasz`} value={opt} className={inputCls}
                onChange={(e) => set('options', f.options.map((o, j) => (j === i ? e.target.value : o)))} />
              <button type="button" onClick={() => removeOption(i)} disabled={f.options.length <= 2}
                className="text-gray-400 hover:text-red-400 disabled:opacity-30 px-2" title="Törlés">✕</button>
            </div>
          ))}
          <button type="button" onClick={() => set('options', [...f.options, ''])}
            className="text-sm text-blue-400 hover:text-blue-300">+ Válaszlehetőség</button>
          {f.type === 'multiple_choice' && (
            <p className="text-xs text-gray-500">Pontozás: (jó jelölések − rossz jelölések) / összes jó × pont, minimum 0.</p>
          )}
        </div>
      )}

      {f.type === 'true_false' && (
        <div className="flex gap-6 text-sm">
          <span className="text-gray-400">Helyes válasz:</span>
          {['Igaz', 'Hamis'].map((label, i) => (
            <label key={i} className="flex items-center gap-2">
              <input type="radio" name="tf" checked={f.correct.includes(i)} onChange={() => set('correct', [i])} />
              {label}
            </label>
          ))}
        </div>
      )}

      {f.type === 'short_text' && (
        <label className="block text-sm text-gray-400">
          Elfogadott válaszok (soronként egy). Kis/nagybetű, szóközök nem számítanak; számoknál 3,14 = 3.14.
          <textarea required rows={3} value={f.accepted} className={`${inputCls} mt-1`}
            placeholder={'Budapest\nBp'} onChange={(e) => set('accepted', e.target.value)} />
        </label>
      )}

      {f.type === 'essay' && (
        <p className="text-sm text-gray-400 bg-gray-900 border border-gray-700 rounded-lg p-3">
          A kifejtős válaszokat az Eredmények fülön kézzel pontozhatod, szöveges visszajelzéssel.
        </p>
      )}

      {f.type === 'code' && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">
            Tesztesetek (stdin → elvárt stdout). A <b>nyilvános</b> teszteket a hallgató példaként látja, a többi rejtett.
            Teszteset nélkül elég, ha a program hiba nélkül lefut.
          </p>
          {f.tests.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
              <textarea rows={2} placeholder="Bemenet" value={t.input} className={`${inputCls} font-mono`}
                onChange={(e) => set('tests', f.tests.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} />
              <textarea rows={2} placeholder="Elvárt kimenet" value={t.expected_output} className={`${inputCls} font-mono`}
                onChange={(e) => set('tests', f.tests.map((x, j) => (j === i ? { ...x, expected_output: e.target.value } : x)))} />
              <div className="flex flex-col items-center gap-1 text-xs text-gray-400">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={t.public}
                    onChange={(e) => set('tests', f.tests.map((x, j) => (j === i ? { ...x, public: e.target.checked } : x)))} />
                  nyilvános
                </label>
                <button type="button" onClick={() => set('tests', f.tests.filter((_, j) => j !== i))}
                  className="hover:text-red-400">✕ törlés</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => set('tests', [...f.tests, emptyTest()])}
            className="text-sm text-blue-400 hover:text-blue-300">+ Teszteset</button>
        </div>
      )}

      <button disabled={saving} className="bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold">
        {saving ? 'Mentés...' : 'Feladat hozzáadása'}
      </button>
    </form>
  );
}
