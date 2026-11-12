'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, getToken } from '@/lib/api';

interface StudentMonitor {
  userId: number;
  name: string;
  online: boolean;
  finished: boolean;
  violations: number;
  lastEvent: string;
  lastTimestamp: string;
}

interface SnapshotItem {
  user_id: number;
  student_name: string;
  violations: number;
  finished: boolean;
  online: boolean;
}

/** Valós idejű proctoring monitor egy vizsgához (a saját vizsgádhoz csatlakozhatsz). */
export function LiveMonitor({ examId }: { examId: number }) {
  const [students, setStudents] = useState<Map<number, StudentMonitor>>(new Map());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setStudents(new Map());
    const socket = io(API_URL, { path: '/socket.io', auth: { token: getToken() } });

    socket.on('connect', () => {
      socket.emit('join_exam', { exam_id: examId }, (ack: { ok: boolean; error?: string }) => {
        setConnected(!!ack?.ok);
        setError(ack?.ok ? '' : ack?.error ?? 'Hiba');
      });
    });
    socket.on('connect_error', (err) => setError(err.message));
    socket.on('disconnect', () => setConnected(false));

    const upsert = (id: number, fn: (s: StudentMonitor) => StudentMonitor, name = 'Ismeretlen') =>
      setStudents((prev) => {
        const next = new Map(prev);
        const existing = next.get(id) ?? {
          userId: id, name, online: true, finished: false, violations: 0, lastEvent: '-', lastTimestamp: '',
        };
        next.set(id, fn(existing));
        return next;
      });

    // Belépéskor az eddigi állapot (oldalfrissítés után is megmarad)
    socket.on('monitor_snapshot', (items: SnapshotItem[]) =>
      setStudents(new Map(items.map((s) => [s.user_id, {
        userId: s.user_id, name: s.student_name, online: s.online, finished: s.finished,
        violations: s.violations, lastEvent: '-', lastTimestamp: '',
      }]))),
    );
    socket.on('student_joined', (d: { user_id: number; student_name: string }) =>
      upsert(d.user_id, (s) => ({ ...s, name: d.student_name, online: true }), d.student_name));
    socket.on('student_left', (d: { user_id: number }) => upsert(d.user_id, (s) => ({ ...s, online: false })));
    socket.on('student_finished', (d: { user_id: number }) =>
      upsert(d.user_id, (s) => ({ ...s, finished: true, online: false })));
    socket.on('violation_alert', (d: { user_id: number; student_name: string; event_type: string; timestamp: string; violations: number }) =>
      upsert(d.user_id, (s) => ({
        ...s, name: d.student_name, violations: d.violations, lastEvent: d.event_type, lastTimestamp: d.timestamp,
      }), d.student_name));

    return () => {
      socket.disconnect();
    };
  }, [examId]);

  const list = Array.from(students.values()).sort((a, b) => b.violations - a.violations || a.name.localeCompare(b.name));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <h2 className="text-lg font-semibold">
          Hallgatók ({list.filter((s) => s.online).length} online, {list.filter((s) => s.finished).length} beadta)
        </h2>
        <span className="flex items-center gap-2 text-sm">
          <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          {connected ? 'Élő kapcsolat' : error || 'Kapcsolódás...'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {list.length === 0 ? (
          <div className="col-span-full bg-gray-800/40 border border-gray-800 rounded-xl p-12 text-center text-gray-400">
            <p className="text-lg font-medium mb-1">Még egy hallgató sem kezdte el a vizsgát</p>
            <p className="text-xs text-gray-500">A belépő hallgatók és ablakváltásaik itt jelennek meg valós időben.</p>
          </div>
        ) : (
          list.map((s) => (
            <div key={s.userId}
              className={`rounded-xl border p-5 transition-all ${
                s.violations > 0 ? 'bg-red-950/20 border-red-500/50 shadow-lg shadow-red-950/20' : 'bg-gray-800 border-gray-700'
              } ${s.online || s.finished ? '' : 'opacity-60'}`}>
              <div className="flex justify-between items-start mb-3 gap-2">
                <div>
                  <h3 className="font-semibold text-lg">{s.name}</h3>
                  <p className="text-xs text-gray-400">
                    {s.finished ? '✓ Beadta' : s.online ? '● Dolgozik' : '○ Nincs a vizsgaoldalon'}
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${
                  s.violations > 0 ? 'bg-red-500' : 'bg-green-600'}`}>
                  {s.violations} figyelmeztetés
                </span>
              </div>
              <div className="space-y-2 text-sm text-gray-400">
                <div className="flex justify-between gap-2">
                  <span>Utolsó esemény:</span>
                  <span className="font-mono text-yellow-400 text-right">{s.lastEvent}</span>
                </div>
                <div className="flex justify-between">
                  <span>Időpont:</span>
                  <span className="font-mono text-gray-300">
                    {s.lastTimestamp ? new Date(s.lastTimestamp).toLocaleTimeString('hu-HU') : '-'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
