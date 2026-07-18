import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSubscription } from '@/context/SubscriptionContext';
import { PRO_PRICE_COPY } from '@/lib/subscription';
import { colors, radii, spacing } from '@/lib/theme';

const PERKS = [
  'AI Guide chat grounded in live gauges & weather',
  'Natural-language trip planner (“smallmouth near Ann Arbor”)',
  'Unlimited Today condition refreshes',
  'Priority fly recommendations tied to the shop',
];

export default function PaywallScreen() {
  const router = useRouter();
  const { isPro, unlockPro, clearPro } = useSubscription();

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>Fly Finder Pro</Text>
      <Text style={styles.pitch}>
        Map apps show you where water is. Pro tells you if it&apos;s worth the drive — and what to
        tie on when you get there.
      </Text>

      {PERKS.map((p) => (
        <Text key={p} style={styles.perk}>
          ✓ {p}
        </Text>
      ))}

      <View style={styles.priceBox}>
        <Text style={styles.price}>{PRO_PRICE_COPY.annual}</Text>
        <Text style={styles.priceSub}>
          or {PRO_PRICE_COPY.monthly} · {PRO_PRICE_COPY.trial}
        </Text>
      </View>

      {isPro ? (
        <>
          <Text style={styles.active}>Pro is active on this device.</Text>
          <Pressable
            style={styles.secondary}
            onPress={async () => {
              await clearPro();
            }}>
            <Text style={styles.secondaryText}>Clear local unlock (dev)</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          style={styles.cta}
          onPress={async () => {
            // StoreKit / RevenueCat wiring comes next — local unlock for Expo Go demos
            await unlockPro();
            router.back();
          }}>
          <Text style={styles.ctaText}>Continue with Pro (demo unlock)</Text>
        </Pressable>
      )}

      <Text style={styles.fine}>
        App Store / Play Billing + RevenueCat will replace the demo unlock before TestFlight.
        Cancel anytime in Apple Subscriptions.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.parchment,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  brand: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 32,
    color: colors.river,
  },
  pitch: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 16,
    color: colors.inkSoft,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  perk: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  priceBox: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    padding: spacing.md,
  },
  price: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 28,
    color: colors.river,
  },
  priceSub: {
    fontFamily: 'SourceSans3_400Regular',
    color: colors.inkSoft,
  },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.rust,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: 'SourceSans3_600SemiBold',
    color: colors.parchment,
    fontSize: 16,
  },
  secondary: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: {
    fontFamily: 'SourceSans3_400Regular',
    color: colors.inkSoft,
    textDecorationLine: 'underline',
  },
  active: {
    marginTop: spacing.md,
    fontFamily: 'SourceSans3_600SemiBold',
    color: colors.go,
  },
  fine: {
    marginTop: spacing.md,
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
});
