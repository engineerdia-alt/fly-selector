import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canUseAiGuide, PRO_PRICE_COPY } from './subscription.ts';

describe('subscription entitlements', () => {
  it('gates AI to Pro', () => {
    assert.equal(
      canUseAiGuide({ isPro: false, source: 'local', updatedAt: '' }),
      false
    );
    assert.equal(
      canUseAiGuide({ isPro: true, source: 'local', updatedAt: '' }),
      true
    );
  });

  it('exposes price copy for the paywall', () => {
    assert.match(PRO_PRICE_COPY.annual, /\$/);
    assert.match(PRO_PRICE_COPY.monthly, /\$/);
  });
});
