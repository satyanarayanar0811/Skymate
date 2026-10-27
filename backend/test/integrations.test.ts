import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirlineAdapter } from '../src/adapters/airlineAdapter';
import { getPaymentProvider } from '../src/adapters/paymentProvider';
import { createWeatherAdapter } from '../src/adapters/weatherAdapter';
import { createCurrencyAdapter } from '../src/adapters/currencyAdapter';
import { createSmsAdapter } from '../src/adapters/smsAdapter';
import { createWhatsAppAdapter } from '../src/adapters/whatsappAdapter';

test('mock airline adapter returns deterministic shaped offers without credentials', async () => {
  process.env.AIRLINE_PROVIDER = 'mock';
  const result = await createAirlineAdapter().search({origin:'BLR',destination:'DEL',date:'2026-11-10',adults:1,cabin:'economy'});
  assert.equal(result.provider,'mock');
  assert.equal(result.offers.length,2);
  assert.equal(result.offers[0].departureAirport,'BLR');
  assert.ok(result.offers[0].total > 0);
});
test('mock payment adapter creates an explicitly mock order', async () => {
  process.env.PAYMENT_PROVIDER = 'mock';
  const result = await getPaymentProvider().createOrder({bookingRef:'SKY-TEST',amount:1000,currency:'INR',idempotencyKey:'integration-test-1'});
  assert.equal(result.status,'paid');
  assert.match(result.id,/^MOCK-/);
});
test('mock weather and currency adapters run without provider credentials', async () => {
  process.env.WEATHER_PROVIDER = 'mock';
  process.env.CURRENCY_PROVIDER = 'static';
  assert.equal((await createWeatherAdapter().forecast('Chennai')).provider,'mock');
  assert.equal((await createCurrencyAdapter().rate('INR','USD')).provider,'static-fallback');
});
test('mock SMS and WhatsApp adapters do not require provider credentials', async () => {
  process.env.NODE_ENV = 'test';
  process.env.SMS_PROVIDER = 'mock';
  process.env.WHATSAPP_PROVIDER = 'mock';
  assert.equal((await createSmsAdapter().send('+919999999999','test')).provider,'mock');
  assert.equal((await createWhatsAppAdapter().send('+919999999999','test')).provider,'mock');
});
