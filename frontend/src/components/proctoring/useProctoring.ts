'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL, getToken } from '@/lib/api';

/**
 * Hallgatói proctoring: JWT-vel csatlakozik a vizsgaszobához, és jelenti az oktatónak,
 * ha a hallgató elhagyja az ablakot (blur) vagy elrejti a lapot (tabváltás).
 * Csak akkor aktív, ha `enabled` igaz (folyamatban lévő kitöltés).
 */
export function useProctoring(examId: string, enabled: boolean, initialViolations = 0) {
  const [connected, setConnected] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [violations, setViolations] = useState(initialViolations);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => setViolations(initialViolations), [initialViolations]);

  useEffect(() => {
    if (!examId || !enabled) return;

    const socket = io(API_URL, { path: '/socket.io', auth: { token: getToken() } });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_exam', { exam_id: Number(examId) }, (ack: { ok: boolean; error?: string }) => {
        setConnected(ack?.ok ?? false);
        setJoinError(ack?.ok ? '' : ack?.error ?? 'Nem sikerült csatlakozni a felügyelethez.');
      });
    });
    socket.on('connect_error', (err) => {
      setConnected(false);
      setJoinError(err.message);
    });
    socket.on('disconnect', () => setConnected(false));

    const report = (eventType: string) => {
      setViolations((v) => v + 1);
      socket.emit('report_violation', { event_type: eventType, timestamp: new Date().toISOString() });
    };

    // Tabváltáskor blur ÉS visibilitychange is jön -> csak egyszer számoljuk
    let away = false;
    // Az oldal elhagyásakor (frissítés, navigáció) a böngésző a pagehide után még
    // "hidden" állapotot jelez – ez nem ablakváltás, ezért ilyenkor nem jelzünk.
    // Az oldal elhagyását az oktató a kapcsolat bontásából (student_left) úgyis látja.
    let unloading = false;
    const handlePageHide = () => {
      unloading = true;
    };
    const handlePageShow = () => {
      unloading = false; // visszatérés a böngésző gyorsítótárából (vissza gomb)
    };
    const handleBlur = () => {
      if (away || unloading) return;
      away = true;
      report('WINDOW_BLUR (ablakfókusz elvesztve)');
    };
    const handleFocus = () => {
      away = false;
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && !away && !unloading) {
        away = true;
        report('TAB_HIDDEN (lapváltás / kis méret)');
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [examId, enabled]);

  /** Beadás után jelez az oktatói monitornak. */
  const notifyFinished = useCallback(() => {
    socketRef.current?.emit('exam_finished');
  }, []);

  return { connected, joinError, violations, notifyFinished };
}
