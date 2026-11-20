import { useEffect } from 'react';
import { useStore } from '@/store/useStore';

/** Advances the replay clock. The clock only scrubs through the already-computed event sequence. */
export function ReplayDriver() {
  const playing = useStore((s) => s.replay.playing);
  const speed = useStore((s) => s.replay.speed);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const st = useStore.getState();
      const r = st.result; const t = st.replay.time;
      if (!r || t === null) return;
      const end = Math.max(...r.events.map((e) => e.time)) + 20;
      const next = t + 3 * st.replay.speed;
      if (next >= end) st.setReplay({ time: end, playing: false });
      else st.setReplay({ time: next });
    }, 60);
    return () => clearInterval(id);
  }, [playing, speed]);
  return null;
}
