import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider } from '../src/adapters/paymentProvider';

test('mock payment provider creates deterministic local order without real keys', async () => {
  process.env.PAYMENT_PROVIDER = 'mock';
  const provider = getPaymentProvider();
  const order = await provider.createOrder({ bookingRef: 'SKY-A1B2C3', amount: 1250, currency: 'INR', idempotencyKey: 'test-order-001' });
  assert.equal(order.bookingRef, 'SKY-A1B2C3');
  assert.equal(order.amount, 1250);
  assert.equal(order.status, 'paid');
  assert.match(order.id, /^MOCK-/);
});

test('unsupported live payment provider fails closed instead of pretending to charge', () => {
  process.env.PAYMENT_PROVIDER = 'stripe';
  assert.throws(() => getPaymentProvider(), /not configured/);
  process.env.PAYMENT_PROVIDER = 'mock';
});
