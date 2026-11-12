export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: 'student' | 'teacher';
}

export type QuestionType = 'code' | 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'essay';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  code: 'Programozási feladat',
  single_choice: 'Feleletválasztós (egy jó válasz)',
  multiple_choice: 'Feleletválasztós (több jó válasz)',
  true_false: 'Igaz / Hamis',
  short_text: 'Rövid szöveges válasz',
  essay: 'Kifejtős (kézi javítás)',
};

export interface PublicTest {
  input: string;
  expected_output: string;
}

/** A hallgató ezt kapja – megoldókulcs nélkül. */
export interface Question {
  id: number;
  exam_id: number;
  position: number;
  type: QuestionType;
  title: string;
  description: string;
  points: number;
  options: string[] | null;
  public_tests: PublicTest[];
}

export interface CodeTestCase extends PublicTest {
  public: boolean;
}

export interface QuestionTeacher extends Question {
  answer_key: number[] | string[] | CodeTestCase[] | null;
}

export interface ExamSummary {
  id: number;
  title: string;
  description: string | null;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  created_by: number;
  question_count: number;
  total_points: number;
}

export interface ExamTeacher extends ExamSummary {
  questions: QuestionTeacher[];
}

/** Kód / szöveg: string; választós: a megjelölt indexek. */
export type AnswerResponse = string | number[] | null;

export type AnswerStatus = 'not_graded' | 'graded' | 'pending_review';

export interface AnswerStudent {
  question_id: number;
  response: AnswerResponse;
  status: AnswerStatus;
  eval_output: string | null;
  score: number | null;
  feedback: string | null;
}

export interface AttemptStudent {
  id: number;
  exam_id: number;
  started_at: string;
  deadline: string;
  finished_at: string | null;
  server_time: string;
  violations: number;
  exam: { id: number; title: string; description: string | null; duration_minutes: number; questions: Question[] };
  answers: AnswerStudent[];
  total_score: number | null;
  max_score: number;
  pending_review: number;
}

export interface AttemptSummary {
  id: number;
  exam_id: number;
  started_at: string;
  deadline: string;
  finished_at: string | null;
  total_score: number | null;
  max_score: number;
  pending_review: number;
}

export interface AnswerTeacher {
  id: number;
  question_id: number;
  response: AnswerResponse;
  auto_score: number | null;
  manual_score: number | null;
  score: number;
  feedback: string | null;
  eval_output: string | null;
  status: AnswerStatus;
}

export interface AttemptTeacher {
  id: number;
  user: { id: number; full_name: string; email: string };
  started_at: string;
  deadline: string;
  finished_at: string | null;
  violations: number;
  total_score: number;
  max_score: number;
  pending_review: number;
  answers: AnswerTeacher[];
}

export type ExamPhase = 'upcoming' | 'active' | 'closed';

export function examPhase(exam: Pick<ExamSummary, 'start_time' | 'end_time'>, now = Date.now()): ExamPhase {
  if (now < new Date(exam.start_time).getTime()) return 'upcoming';
  if (now >= new Date(exam.end_time).getTime()) return 'closed';
  return 'active';
}

export function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('hu-HU') : '-';
}

export function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('token');
}

async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401 && token) {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join(', ')
      : data.detail;
    throw new Error(detail || `Hiba (${res.status})`);
  }
  return res;
}

/** fetch a backend felé, automatikus Bearer tokennel. 401 esetén kijelentkeztet. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await request(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fájl letöltése (pl. CSV export) hitelesített kéréssel. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const blob = await (await request(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
