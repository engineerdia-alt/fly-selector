# Fly Finder (iOS / Android)

Subscription-based outing app for **Fly Fishing Universe** — built with Expo so you can run it in **Expo Go** on your phone while iterating.

## Positioning (vs TroutRoutes + DIY Fishing)

Those apps win on proprietary map layers and curated access density. We do **not** try to out-map onX in v1.

**Fly Finder wins on the decision layer:**

1. **Should I go?** — live weather + USGS go/no-go verdict  
2. **What do I fish?** — AI guide grounded in conditions (Pro)  
3. **Where, specifically?** — curated destination intel + growing access  
4. **What do I buy?** — shop-tied fly recommendations (next)

## Run on your iPhone (Expo Go)

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Camera / Expo Go. Grant location when prompted.

For a native Xcode build later:

```bash
npx expo prebuild --platform ios
npx expo run:ios
```

## App structure

| Tab / screen | Role |
|--------------|------|
| **Today** | Location + live conditions → go / caution / no-go |
| **Explore** | Map + search over 57 curated waters from the web tool |
| **Guide** | Pro: `/plan` + `/ask` against the existing Cloudflare worker |
| **Log** | Local trip notes |
| **Paywall** | Pro gates AI; demo unlock until StoreKit + RevenueCat |

## Scripts

```bash
npm test          # go/no-go + destinations unit tests
npm run lint:ci   # tsc --noEmit + tests
```

## Subscription (next)

- Wire **RevenueCat** + App Store products (`ff_pro_monthly`, `ff_pro_annual`)
- Keep `lib/subscription.ts` as the entitlement facade
- Free: Explore + spot cards + one Today load  
- Pro: AI Guide / Plan, unlimited refreshes, later offline packs

## Worker CORS note

React Native does not enforce browser CORS. Shop-origin allowlisting still matters for the web embed; the mobile app talks to `api.flyfishingfinder.com` directly.
