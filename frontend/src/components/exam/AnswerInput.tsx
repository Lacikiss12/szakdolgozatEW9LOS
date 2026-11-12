'use client';

import { AnswerResponse, Question } from '@/lib/api';

interface Props {
  question: Question;
  value: AnswerResponse;
  onChange: (value: AnswerResponse) => void;
  disabled?: boolean;
}

const textCls =
  'w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-70';

/** Nem kódos feladatok válaszmezője (választós, igaz/hamis, rövid szöveg, esszé). */
export function AnswerInput({ question, value, onChange, disabled }: Props) {
  const selected = Array.isArray(value) ? value : [];

  switch (question.type) {
    case 'single_choice':
    case 'true_false':
    case 'multiple_choice': {
      const multi = question.type === 'multiple_choice';
      const toggle = (i: number) => {
        if (!multi) return onChange([i]);
        onChange(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i].sort((a, b) => a - b));
      };
      return (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            {multi ? 'Több helyes válasz is lehet – a rossz jelölés pontlevonással jár.' : 'Egy választ jelölj meg.'}
          </p>
          {(question.options ?? []).map((opt, i) => (
            <label key={i}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                selected.includes(i) ? 'border-blue-500 bg-blue-900/30' : 'border-gray-700 bg-gray-900 hover:border-gray-500'
              } ${disabled ? 'cursor-default opacity-80' : ''}`}>
              <input type={multi ? 'checkbox' : 'radio'} name={`q-${question.id}`} checked={selected.includes(i)}
                disabled={disabled} onChange={() => toggle(i)} />
              <span className="text-sm">{opt}</span>
            </label>
          ))}
          {!multi && selected.length > 0 && !disabled && (
            <button type="button" onClick={() => onChange([])} className="text-xs text-gray-400 hover:text-gray-200">
              Jelölés törlése
            </button>
          )}
        </div>
      );
    }
    case 'short_text':
      return (
        <input value={typeof value === 'string' ? value : ''} disabled={disabled} maxLength={1000}
          placeholder="Rövid válasz..." onChange={(e) => onChange(e.target.value)} className={textCls} />
      );
    case 'essay':
      return (
        <div>
          <textarea value={typeof value === 'string' ? value : ''} disabled={disabled} rows={14} maxLength={50000}
            placeholder="Fejtsd ki a válaszod..." onChange={(e) => onChange(e.target.value)} className={textCls} />
          <p className="text-xs text-gray-500 mt-1 text-right">
            {(typeof value === 'string' ? value : '').trim().split(/\s+/).filter(Boolean).length} szó
          </p>
        </div>
      );
    default:
      return null;
  }
}

/** Egy beadott válasz csak olvasható megjelenítése (eredményoldal, oktatói javítás). */
export function AnswerReadonly({ question, value, correct }: { question: Question; value: AnswerResponse; correct?: number[] }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0) || value === '') {
    return <p className="text-sm italic text-gray-500">(nincs válasz)</p>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="space-y-1 text-sm">
        {(question.options ?? []).map((opt, i) => {
          const sel = value.includes(i);
          const ok = correct?.includes(i);
          return (
            <li key={i} className={`flex gap-2 ${sel ? 'text-white' : 'text-gray-500'}`}>
              <span>{sel ? '☑' : '☐'}</span>
              <span>{opt}</span>
              {correct && ok && <span className="text-green-400 text-xs">(helyes)</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <pre className={`text-sm whitespace-pre-wrap bg-gray-900 border border-gray-700 rounded-lg p-3 ${
      question.type === 'code' ? 'font-mono text-green-300' : 'font-sans'}`}>
      {value}
    </pre>
  );
}
