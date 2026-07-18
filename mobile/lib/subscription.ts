import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ff.subscription.v1';

export type Entitlement = {
  isPro: boolean;
  /** 'local' until StoreKit / Play Billing + RevenueCat are wired */
  source: 'local' | 'store';
  updatedAt: string;
};

const FREE: Entitlement = {
  isPro: false,
  source: 'local',
  updatedAt: new Date(0).toISOString(),
};

export async function getEntitlement(): Promise<Entitlement> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return FREE;
    return { ...FREE, ...JSON.parse(raw) };
  } catch {
    return FREE;
  }
}

/** Dev / TestFlight stub — replace with RevenueCat purchase(). */
export async function unlockProLocally(): Promise<Entitlement> {
  const next: Entitlement = {
    isPro: true,
    source: 'local',
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function clearProLocally(): Promise<Entitlement> {
  await AsyncStorage.setItem(KEY, JSON.stringify(FREE));
  return FREE;
}

/** Free tier: browse Explore + basic spot cards. Pro: AI Guide, Ask planner, unlimited Today refreshes. */
export function canUseAiGuide(entitlement: Entitlement): boolean {
  return entitlement.isPro;
}

export const PRO_PRICE_COPY = {
  monthly: '$7.99/mo',
  annual: '$49.99/yr',
  trial: '7-day free trial',
};
