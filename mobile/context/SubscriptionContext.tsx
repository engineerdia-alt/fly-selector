import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  Entitlement,
  canUseAiGuide,
  clearProLocally,
  getEntitlement,
  unlockProLocally,
} from '@/lib/subscription';

type Ctx = {
  entitlement: Entitlement;
  loading: boolean;
  isPro: boolean;
  canUseAi: boolean;
  refresh: () => Promise<void>;
  unlockPro: () => Promise<void>;
  clearPro: () => Promise<void>;
};

const SubscriptionContext = createContext<Ctx | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [entitlement, setEntitlement] = useState<Entitlement>({
    isPro: false,
    source: 'local',
    updatedAt: new Date(0).toISOString(),
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const e = await getEntitlement();
    setEntitlement(e);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<Ctx>(
    () => ({
      entitlement,
      loading,
      isPro: entitlement.isPro,
      canUseAi: canUseAiGuide(entitlement),
      refresh,
      unlockPro: async () => setEntitlement(await unlockProLocally()),
      clearPro: async () => setEntitlement(await clearProLocally()),
    }),
    [entitlement, loading, refresh]
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription requires SubscriptionProvider');
  return ctx;
}
