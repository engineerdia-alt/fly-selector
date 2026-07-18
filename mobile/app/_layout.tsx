import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  useFonts as useFraunces,
} from '@expo-google-fonts/fraunces';
import {
  SourceSans3_400Regular,
  SourceSans3_600SemiBold,
  useFonts as useSourceSans,
} from '@expo-google-fonts/source-sans-3';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { colors } from '@/lib/theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [frauncesLoaded] = useFraunces({ Fraunces_500Medium, Fraunces_600SemiBold });
  const [sourceLoaded] = useSourceSans({ SourceSans3_400Regular, SourceSans3_600SemiBold });
  const loaded = frauncesLoaded && sourceLoaded;

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <SubscriptionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.river },
          headerTintColor: colors.parchment,
          headerTitleStyle: { fontFamily: 'Fraunces_600SemiBold' },
          contentStyle: { backgroundColor: colors.parchment },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="spot/[id]" options={{ title: 'Water' }} />
        <Stack.Screen
          name="paywall"
          options={{ presentation: 'modal', title: 'Fly Finder Pro' }}
        />
      </Stack>
    </SubscriptionProvider>
  );
}
