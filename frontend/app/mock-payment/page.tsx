'use client';

import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');

export default function MockPaymentPage() {
  const [bookingRef, setBookingRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<string[]>([]);

  useEffect(() => {
    setBookingRef(new URLSearchParams(window.location.search).get('ref') || '');
  }, []);

  async function pay() {
    if (!bookingRef || busy || paid) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/chat-bookings/${encodeURIComponent(bookingRef)}/mock-pay`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Mock payment could not be completed.');
      setNotifications(result.notifications || []);
      setPaid(true);
      window.setTimeout(() => window.location.assign('/'), 6000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: '64px auto', padding: 28, fontFamily: 'Arial,sans-serif', background: 'white', border: '1px solid #dfe6ef', borderRadius: 20 }}>
      <a href="/">← Back to SkyMate</a>
      <h1>Mock payment gateway</h1>
      {!paid ? <>
        <p>Booking reference: <strong>{bookingRef || 'Loading…'}</strong></p>
        <p>This demo checkout does not charge real money.</p>
        {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
        <button className="primary" disabled={!bookingRef || busy} onClick={() => void pay()}>{busy ? 'Processing…' : 'Pay with mock gateway'}</button>
      </> : <section role="status" style={{ marginTop: 24, padding: 18, borderRadius: 12, background: '#e8f8ef', color: '#14532d' }}>
        <h2>Payment successful</h2>
        <p>Demo ticket booking {bookingRef} is confirmed. It is not a valid airline-issued ticket.</p>
        <p>Booking confirmation alerts: {notifications.length ? notifications.join(' · ') : 'No email or phone was available.'}</p>
        <p>Returning to SkyMate chat…</p>
      </section>}
    </main>
  );
}
