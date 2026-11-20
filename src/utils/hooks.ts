import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { recoveredSet } from '@/utils/selectors';

/** Non-null simulation context (App guards against a missing dataset before rendering anything that uses this). */
export function useSim() {
  const net = useStore((s) => s.network)!;
  const result = useStore((s) => s.result)!;
  const base = useStore((s) => s.baseResult)!;
  const rec = useMemo(() => recoveredSet(result, base), [result, base]);
  return { net, result, base, rec };
}
