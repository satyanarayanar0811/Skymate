import { getPaymentProvider } from '../adapters/paymentProvider';

import { createAirlineAdapter } from '../adapters/airlineAdapter';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import express from 'express';

import crypto from 'node:crypto';

import type { Pool } from 'mysql2/promise';

import { createEmailAdapter } from '../adapters/emailAdapter';
import { enqueueNotification } from '../services/notificationQueue';

import jwt from 'jsonwebtoken';

import type Redis from 'ioredis';

import { z } from 'zod';

import { validateRequest } from '../middleware/validateRequest';

import { requireAuth, requireRole } from '../middleware/auth';

import { FlightRepository } from '../repositories/flightRepository';

const router = express.Router();

const airports: Record<string, string> = { BLR: 'Bengaluru', DEL: 'Delhi', MAA: 'Chennai', BOM: 'Mumbai', HYD: 'Hyderabad', CCU: 'Kolkata', GOI: 'Goa', COK: 'Kochi', PNQ: 'Pune', AMD: 'Ahmedabad' };

const code = (v: string) => { const s = v.trim().toLowerCase(); return Object.entries(airports).find(([k, n]) => k.toLowerCase() === s || n.toLowerCase() === s)?.[0] || v.trim().toUpperCase().slice(0, 3) ;};

const jwtSecret = () => { const secret = process.env.JWT_SECRET; if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters'); return secret; };

const hashOtp = (email: string, otp: string) => crypto.createHash('sha256').update(`${email.toLowerCase()}:${otp}:${jwtSecret()}`).digest('hex');

let pool: Pool;

let redis: Redis;

let flightRepository: FlightRepository;

export function configureApi(deps: { pool: Pool; redis: Redis ;}) { pool = deps.pool; redis = deps.redis; flightRepository = new FlightRepository(pool); return router; }

// Every route passes through structural Zod validation; mutation routes also enforce field-level validation below.

router.use(validateRequest);

function flightDto(r: any) { return { id: String(r.id), flightNo: r.flight_no, airline: r.airline, from: r.departure_code, to: r.arrival_code, fromCity: airports[r.departure_code] || r.departure_code, toCity: airports[r.arrival_code] || r.arrival_code, departure: new Date(r.departure_at).toTimeString().slice(0, 5), arrival: new Date(r.arrival_at).toTimeString().slice(0, 5), departureAt: r.departure_at, arrivalAt: r.arrival_at, economy: Number(r.economy_fare), premiumEconomy: Number(r.premium_economy_fare || r.economy_fare), business: Number(r.business_fare), seatsAvailable: Number(r.seats_available), status: r.status, baggage: 'Allowance varies by airline and fare; verify with the airline.' } ;}

async function getBooking(ref: string) {
  const [rows] = await pool.execute<any[]>(
    'SELECT b.*, f.flight_no,f.airline,f.departure_code,f.arrival_code,f.departure_at,f.arrival_at,f.economy_fare,f.business_fare,f.seats_available,f.status flight_status FROM bookings b LEFT JOIN flights f ON f.id=b.flight_id WHERE b.booking_ref=?',
    [ref.toUpperCase()],
  );
  if (!rows.length) return null;
  const row = rows[0];
  const details = typeof row.passenger_details === 'string' ? JSON.parse(row.passenger_details) : row.passenger_details;
  const passengers = Array.isArray(details) ? details : Array.isArray(details?.passengers) ? details.passengers : [];
  const providerFlight = details?.flight || {};
  const asTime = (value: unknown) => {
    if (!value) return '';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? '' : date.toTimeString().slice(0, 5);
  };
  const flight = row.flight_id ? {
    id: String(row.flight_id), flightNo: row.flight_no, airline: row.airline,
    from: row.departure_code, to: row.arrival_code, departure: asTime(row.departure_at),
    arrival: asTime(row.arrival_at), departureAt: row.departure_at, arrivalAt: row.arrival_at, economy: Number(row.economy_fare),
    premiumEconomy: Number(row.premium_economy_fare || row.economy_fare),
    business: Number(row.business_fare), seatsAvailable: Number(row.seats_available),
    status: row.flight_status, baggage: 'Verify allowance with airline.',
  } : {
    id: '', flightNo: providerFlight.flightNumber || providerFlight.flightNo || '',
    airline: providerFlight.airline || '', from: providerFlight.departureAirport || providerFlight.origin || '',
    to: providerFlight.arrivalAirport || providerFlight.destination || '',
    departure: asTime(providerFlight.departureAt || providerFlight.departure_at),
    arrival: asTime(providerFlight.arrivalAt || providerFlight.arrival_at),
    departureAt: providerFlight.departureAt || providerFlight.departure_at,
    arrivalAt: providerFlight.arrivalAt || providerFlight.arrival_at,
    economy: Number(row.total_amount), premiumEconomy: Number(row.total_amount),
    business: Number(row.total_amount), seatsAvailable: 0, status: 'Provider offer',
    baggage: 'Verify allowance with airline.',
  };
  return {
    ref: row.booking_ref, flight, passengers: row.passenger_count, cabin: row.cabin_class,
    seats: typeof row.seats === 'string' ? JSON.parse(row.seats) : row.seats,
    names: passengers.map((passenger: any) => typeof passenger === 'string' ? passenger : passenger.name || passenger.fullName || ''),
    email: row.email || '', amount: Number(row.total_amount), status: row.status,
    paymentStatus: row.payment_status, refundStatus: row.refund_status,
    checkedIn: Boolean(row.checked_in), createdAt: row.created_at,
  };
}

async function queueCancellationNotifications(ref: string, booking: any) {
  let details: any = {};
  try {
    const [rows] = await pool.execute<any[]>('SELECT passenger_details FROM bookings WHERE booking_ref=?', [ref]);
    const raw = rows[0]?.passenger_details;
    details = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  } catch {}
  const passengers = Array.isArray(details) ? details : Array.isArray(details?.passengers) ? details.passengers : [];
  const email = booking.email || passengers[0]?.email;
  const phones = [...new Set<string>(passengers.map((passenger: any) => String(passenger.phone || '')).filter(Boolean))];
  if (!email && phones.length === 0) return [];

  const legacySentKey = `booking-cancellation-notice:${ref}`;

  const passengerName = booking.names?.[0] || passengers[0]?.name || 'traveller';
  const flight = booking.flight || {};
  const refundStatus = String(booking.refundStatus || 'NOT_REQUESTED');
  const refundAmount = Number(booking.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const refundDetail = refundStatus === 'REFUNDED'
    ? `Refund status: REFUNDED. INR ${refundAmount} was reversed in the mock payment record; no real money was moved.`
    : refundStatus === 'FAILED'
      ? 'Refund status: FAILED. No successful refund is recorded; please contact support.'
      : `Refund status: ${refundStatus}.`;
  const body = [
    `Hello ${String(passengerName).split(/\s+/)[0]},`,
    '',
    `Your SkyMate reservation ${ref} has been cancelled.`,
    `Flight: ${flight.airline || ''} ${flight.flightNo || ''}`.trim(),
    `Route: ${flight.from || 'Not provided'} to ${flight.to || 'Not provided'}`,
    `Departure: ${flight.departureAt ? new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(flight.departureAt))+' IST' : flight.departure || 'Not provided'}`,
    `Arrival: ${flight.arrivalAt ? new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(flight.arrivalAt))+' IST' : flight.arrival || 'Not provided'}`,
    refundDetail,
    '',
    'This is a demo booking notification. It is not an airline-issued cancellation receipt or ticket.',
  ].join('\n');
  const notices: string[] = [];
  const enqueueOnce = async (key: string, job: Parameters<typeof enqueueNotification>[0], label: string) => {
    const claimed = await redis.set(key, 'queued', 'EX', 60 * 60 * 24 * 30, 'NX');
    if (!claimed) { notices.push(`${label} already queued`); return; }
    try { await enqueueNotification(job); notices.push(`${label} queued`); }
    catch { await redis.del(key); notices.push(`${label} could not be queued`); }
  };
  if (email && await redis.set(legacySentKey, 'queued', 'EX', 60 * 60 * 24 * 30, 'NX')) {
    try {
      await enqueueNotification({ channel: 'email', to: email, template: 'booking-cancellation', subject: `SkyMate cancellation and refund update · ${ref}`, message: body });
      notices.push('cancellation email queued');
    } catch {
      await redis.del(legacySentKey);
      notices.push('cancellation email could not be queued');
    }
  } else if (email) {
    notices.push('cancellation email already queued');
  }
  for (const phone of phones) {
    const message = `SkyMate: ${ref} (${flight.airline || ''} ${flight.flightNo || ''}) is cancelled. Refund: ${refundStatus}${refundStatus === 'REFUNDED' ? `, mock INR ${refundAmount}; no real money moved` : ''}. Demo only.`;
    const base = `booking-cancellation-notice:${ref}:${encodeURIComponent(phone)}`;
    await enqueueOnce(`${base}:sms`, { channel: 'sms', to: phone, template: 'booking-cancellation', subject: `SkyMate cancellation ${ref}`, message }, 'cancellation SMS');
    await enqueueOnce(`${base}:whatsapp`, { channel: 'whatsapp', to: phone, template: 'booking-cancellation', subject: `SkyMate cancellation ${ref}`, message: body }, 'cancellation WhatsApp');
  }
  return notices;
}

function zodQuery(shape: Record<string, z.ZodTypeAny>) {

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {

    const result = z.object(shape).safeParse(req.query);

    if (!result.success) return res.status(400).json({ error: 'Query validation failed', issues: result.error.issues.map(i => ({ path: i.path, message: i.message })) });

    next();

  };

}

function zodParams(shape: Record<string, z.ZodTypeAny>) {

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {

    const result = z.object(shape).safeParse(req.params);

    if (!result.success) return res.status(400).json({ error: 'Path validation failed', issues: result.error.issues.map(i => ({ path: i.path, message: i.message })) });

    next();

  };

}

function zodBody(shape: Record<string, z.ZodTypeAny>) {

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {

    const result = z.object(shape).safeParse(req.body ?? {});

    if (!result.success) return res.status(400).json({ error: 'Request validation failed', issues: result.error.issues.map(i => ({ path: i.path, message: i.message })) });

    req.body = result.data; next();

  };

}

// Email delivery is selected through EMAIL_PROVIDER.

const emailAdapter = createEmailAdapter();

router.post('/api/auth/send-otp', zodBody({ email: z.string().email().max(254) }), async (req, res) => {

  const email = String(req.body?.email || '').trim().toLowerCase();

  const sendLimitKey = `otp-send:${email}`;

  const sendCount = Number(await redis.get(sendLimitKey) || 0);

  if (sendCount >= 3) return res.status(429).json({ error: 'OTP resend limit reached. Try again later.' });

  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

  try {

    await emailAdapter.sendOtp(email, otp);

    await redis.set(`otp:${email}`, JSON.stringify({ hash: hashOtp(email, otp), attempts: 0 }), 'EX', 300);

    await redis.multi().incr(sendLimitKey).expire(sendLimitKey, 3600).exec();

    res.json({ ok: true, message: 'Verification code sent. Check your email inbox and spam folder.' });

  } catch (e) { res.status(502).json({ error: 'Could not send verification email. Check EMAIL_PROVIDER and SMTP settings.' }); }

});

router.post('/api/auth/verify-otp', zodBody({ email: z.string().email().max(254), otp: z.string().regex(/^\d{6}$/) }), async (req, res) => {

  const email = String(req.body?.email || '').trim().toLowerCase(), otp = String(req.body?.otp || '').trim();

  const raw = await redis.get(`otp:${email}`);

  if (!raw) return res.status(400).json({ error: 'Code expired or not requested. Request a new code.' });

  const saved = JSON.parse(raw) as { hash: string; attempts: number ;};

  if (saved.attempts >= 3) { await redis.del(`otp:${email}`); return res.status(429).json({ error: 'Too many attempts. Request a new code.' }); }

  const candidateHash = hashOtp(email, otp); const validOtp = /^\d{6}$/.test(otp) && crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(saved.hash, 'hex')); if (!validOtp) { saved.attempts += 1; const ttl = Math.max(1, await redis.ttl(`otp:${email}`)); await redis.set(`otp:${email}`, JSON.stringify(saved), 'EX', ttl); return res.status(400).json({ error: 'Incorrect verification code.' }); }

  await redis.del(`otp:${email}`);

  try {

    const [existing] = await pool.execute<any[]>('SELECT id,email,full_name,role FROM users WHERE email=? LIMIT 1', [email]);

    let user: any;

    if (existing.length) { user = existing[0]; await pool.execute('UPDATE users SET email_verified=TRUE WHERE id=?', [user.id]); }

    else { const [r]: any = await pool.execute('INSERT INTO users(email,full_name,role,email_verified) VALUES(?,?,?,TRUE)', [email, email.split('@')[0], 'customer']); user = { id: r.insertId, email, full_name: email.split('@')[0], role: 'customer' }; }

    const token = jwt.sign({ sub: String(user.id), role: user.role, email: user.email }, jwtSecret(), { expiresIn: '2h' });

    res.json({ ok: true, token, user: { id: String(user.id), email: user.email, name: user.full_name, role: user.role }, message: 'Email verified successfully.' });

  } catch (e) { res.status(500).json({ error: 'Could not create user record. Check server logs and database readiness.' }); }

});

router.post('/api/auth/guest', zodBody({ name: z.string().trim().min(2).max(120).optional(), email: z.string().email().max(254).optional(), phone: z.string().min(7).max(32).optional() }), async (req, res) => {

  const guestId = 'guest-' + crypto.randomUUID(); const session = { id: guestId, name: req.body.name || 'Guest traveller', email: req.body.email || null, phone: req.body.phone || null, createdAt: new Date().toISOString() }; await redis.set(`guest:${guestId}`, JSON.stringify(session), 'EX', 43200);

  const token = jwt.sign({ sub: guestId, role: 'customer', guest: true, email: session.email }, jwtSecret(), { expiresIn: '12h' });

  res.json({ ok: true, token, user: { id: guestId, email: session.email, name: session.name, role: 'customer', guest: true }, message: 'Continuing as guest. Email verification is not required for guest browsing.' });

});

const airlineSearchAdapter = createAirlineAdapter();

router.get(
  '/api/integrations/flights/search',
  zodQuery({
    origin: z.string().length(3).transform((v) => v.toUpperCase()),
    destination: z.string().length(3).transform((v) => v.toUpperCase()),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    adults: z.coerce.number().int().min(1).max(9).default(1),
    cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
    returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  async (req, res) => {
    try {
      const q = {
        origin: String(req.query.origin ?? ''),
        destination: String(req.query.destination ?? ''),
        date: String(req.query.date ?? ''),
        adults: Number(req.query.adults ?? 1),
        cabin: req.query.cabin
        ? String(req.query.cabin)
        : undefined,
        returnDate: req.query.returnDate
        ? String(req.query.returnDate)
        : undefined,
      };

      const result = await airlineSearchAdapter.search({
        origin: q.origin,
        destination: q.destination,
        date: q.date,
        adults: Number(q.adults ?? 1),
        cabin: q.cabin,
        returnDate: q.returnDate,
      });

      res.json({
        ...result,
        notice:
          result.provider === 'mock'
            ? 'Provider offers returned. Availability, final fare and ticketing require confirmation by the operating airline.'
            : 'External provider offers; verify availability and ticketing with the provider.',
      });
    } catch (error) {
      console.error('External flight search failed:', error);
      res.status(502).json({
        error: error instanceof Error ? error.message : 'External flight search failed.',
      });
    }
  },
);

router.get('/api/flights', zodQuery({ from: z.string().min(2).max(120).optional(), to: z.string().min(2).max(120).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), cabin: z.enum(['economy', 'business', 'premium_economy']).optional(), passengers: z.coerce.number().int().min(1).max(9).optional() }), async (req, res) => { try { const from = code(String(req.query.from || 'BLR')), to = code(String(req.query.to || 'DEL')), date = String(req.query.date || new Date().toISOString().slice(0, 10)), cabin = String(req.query.cabin || 'economy').toLowerCase(), p = Math.max(1, Math.min(9, Number(req.query.passengers || 1))); const rows = await flightRepository.findByRouteAndDate(from, to, date, p); res.json({ demo: true, flights: rows.map(r => ({ ...flightDto(r), date, price: Number(cabin === 'business' ? r.business_fare : cabin === 'premium_economy' ? (r.premium_economy_fare || r.economy_fare) : r.economy_fare) * p, cabin })), notice: 'Sample inventory and fares only; not live airline availability.' }) ;} catch (e) { res.status(500).json({ error: 'Flight search failed. Check server logs and database readiness.' }) ;} });

router.get('/api/status/:flightNo', zodParams({ flightNo: z.string().min(2).max(30) }), async (req, res) => { try { const [rs] = await pool.execute<any[]>('SELECT * FROM flights WHERE LOWER(flight_no)=LOWER(?)', [req.params.flightNo]); if (!rs.length) return res.status(404).json({ error: 'Flight not found in demo inventory.' }); const f = flightDto(rs[0]); res.json({ demo: true, flightNo: f.flightNo, status: f.status, departure: f.departure, arrival: f.arrival, from: f.from, to: f.to }) ;} catch (e) { res.status(500).json({ error: 'Request failed. Check server logs for the request ID.' }) ;} });

router.get('/api/baggage', (_q, res) => res.json({ demo: true, message: 'Baggage allowances vary by airline, route and fare. Verify directly with the operating airline.' }));

router.post('/api/bookings', zodBody({ flightId: z.union([z.string().min(1), z.number().int().positive()]), passengers: z.coerce.number().int().min(1).max(9).optional(), cabin: z.enum(['economy', 'business', 'premium_economy']).optional(), seats: z.array(z.string().min(1).max(5)).max(9), names: z.array(z.string().trim().min(1).max(120)).max(9), email: z.string().email().max(254).optional() }), async (req, res) => { const { flightId, passengers = 1, cabin = 'economy', seats = [], names = [], email = '' } = req.body || {}; const count = Number(passengers); if (!Number.isInteger(count) || count < 1 || count > 9) return res.status(400).json({ error: 'Passenger count must be 1–9.' }); if (!Array.isArray(seats) || seats.length !== count || new Set(seats).size !== count) return res.status(400).json({ error: 'Choose one unique seat per passenger.' }); if (!Array.isArray(names) || names.length !== count || names.some((n: string) => typeof n !== 'string' || !n.trim())) return res.status(400).json({ error: 'Enter a name for each passenger.' }); const conn = await pool.getConnection(); try { await conn.beginTransaction(); const [rs] = await conn.execute<any[]>('SELECT * FROM flights WHERE id=? FOR UPDATE', [flightId]); if (!rs.length) { await conn.rollback(); return res.status(400).json({ error: 'Flight not found. Search again.' }) ;} const f = rs[0]; if (Number(f.seats_available) < count) { await conn.rollback(); return res.status(409).json({ error: 'Not enough seats remain.' }) ;} const [taken] = await conn.execute<any[]>('SELECT seats FROM bookings WHERE flight_id=? AND status NOT LIKE \'CANCELLED%\'', [flightId]); const occupied = new Set<string>(); for (const r of taken) { const a = typeof r.seats === 'string' ? JSON.parse(r.seats) : r.seats; for (const s of a) occupied.add(s) ;} if (seats.some((s: string) => occupied.has(s))) { await conn.rollback(); return res.status(409).json({ error: 'One or more seats are already booked. Choose different seats.' }) ;} let seatRecords: any[] = []; const [instanceRows]: any = await conn.execute('SELECT id FROM flight_instances WHERE flight_id=? ORDER BY flight_date LIMIT 1 FOR UPDATE', [f.id]); if (instanceRows[0]) { const placeholders = seats.map(() => '?').join(','); const [seatRows]: any = await conn.execute(`SELECT id,seat_number,status,hold_expires_at FROM seats WHERE flight_instance_id=? AND seat_number IN (${placeholders}) FOR UPDATE`, [instanceRows[0].id, ...seats]); seatRecords = seatRows.sort((a: any, b: any) => seats.indexOf(a.seat_number) - seats.indexOf(b.seat_number)); if (seatRows.length !== count || seatRows.some((s: any) => s.status === 'BOOKED' || s.status === 'BLOCKED' || (s.status === 'HELD' && s.hold_expires_at && new Date(s.hold_expires_at) > new Date()))) { await conn.rollback(); return res.status(409).json({ error: 'One or more seats are unavailable. Refresh the seat map.' }) ;} } const ref = 'SKY-' + crypto.randomBytes(3).toString('hex').toUpperCase(), amount = Number(cabin === 'business' ? f.business_fare : cabin === 'premium_economy' ? ((await conn.execute<any[]>('SELECT premium_economy_fare FROM flight_instances WHERE flight_id=? LIMIT 1', [f.id]))[0][0]?.premium_economy_fare || f.economy_fare) : f.economy_fare) * count; const mockPayment = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase() === 'mock'; const [bookingInsert]: any = await conn.execute('INSERT INTO bookings(booking_ref,flight_id,passenger_count,cabin_class,seats,passenger_details,total_amount,status,payment_status,refund_status,email) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [ref, f.id, count, cabin, JSON.stringify(seats), JSON.stringify(names.map((name: string) => ({ name }))), amount, mockPayment ? 'CONFIRMED (DEMO)' : 'PENDING', mockPayment ? 'SIMULATED_SUCCESS' : 'PENDING', 'NOT_REQUESTED', email || null]); for (let i = 0; i < names.length; i++) { const parts = String(names[i]).trim().split(/\s+/); const [passengerInsert]: any = await conn.execute('INSERT INTO passengers(booking_id,passenger_type,first_name,last_name) VALUES(?,?,?,?)', [bookingInsert.insertId, 'adult', parts[0], parts.slice(1).join(' ') || 'Traveller']); if (seatRecords[i]) await conn.execute('INSERT INTO booking_seats(booking_id,seat_id,passenger_id,price) VALUES(?,?,?,?)', [bookingInsert.insertId, seatRecords[i].id, passengerInsert.insertId, 0]); } if (seatRecords.length) await conn.execute(`UPDATE seats SET status='BOOKED',hold_expires_at=NULL WHERE id IN (${seatRecords.map(() => '?').join(',')})`, seatRecords.map((s: any) => s.id)); await conn.execute('UPDATE flights SET seats_available=seats_available-? WHERE id=?', [count, f.id]); if (mockPayment) await conn.execute('INSERT INTO transactions(booking_ref,provider,amount,status) VALUES(?,?,?,?)', [ref, 'mock', amount, 'SIMULATED_SUCCESS']); await conn.commit(); res.status(201).json({ demo: mockPayment, booking: await getBooking(ref), message: mockPayment ? 'Booking saved in MySQL. Mock payment is simulated; no real ticket issued.' : 'Booking created as PENDING. Complete the configured payment-provider checkout before the booking is confirmed.' }) ;} catch (e) { await conn.rollback(); res.status(500).json({ error: 'Could not create booking. Check server logs for the request ID.' }) ;} finally { conn.release() ;} });

router.get('/api/bookings/:ref', zodParams({ ref: z.string().min(4).max(40) }), async (req, res) => { try { const b = await getBooking(req.params.ref); if (!b) return res.status(404).json({ error: 'Booking not found.' }); res.json({ demo: true, booking: b }) ;} catch (e) { res.status(500).json({ error: 'Request failed. Check server logs for the request ID.' }) ;} });

router.post('/api/bookings/:ref/cancel', zodParams({ ref: z.string().min(4).max(40) }), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rs] = await conn.execute<any[]>('SELECT * FROM bookings WHERE booking_ref=? FOR UPDATE', [req.params.ref.toUpperCase()]);
    if (!rs.length) { await conn.rollback(); return res.status(404).json({ error: 'Booking not found.' }); }
    const b = rs[0];
    if (String(b.status).startsWith('CANCELLED')) {
      const [payments]: any = await conn.execute<any[]>("SELECT id,provider FROM transactions WHERE booking_ref=? AND status IN ('SUCCESS','PAID','SIMULATED_SUCCESS') ORDER BY id DESC LIMIT 1", [b.booking_ref]);
      const [refunds]: any = await conn.execute<any[]>('SELECT id,status FROM refunds WHERE booking_ref=? ORDER BY id DESC LIMIT 1', [b.booking_ref]);
      if (payments[0]?.provider === 'mock' && refunds[0]?.status === 'FAILED') {
        const mockReference = `MOCK-REF-${b.booking_ref}`;
        await conn.execute("UPDATE refunds SET status='REFUNDED',provider_reference=?,reason='Mock payment reversed; no real funds were moved' WHERE id=?", [mockReference, refunds[0].id]);
        await conn.execute("UPDATE bookings SET refund_status='REFUNDED' WHERE booking_ref=?", [b.booking_ref]);
        await conn.commit();
        const current = await getBooking(req.params.ref);
        const notifications = await queueCancellationNotifications(b.booking_ref, current);
        return res.json({ demo: true, booking: current, notifications, message: `Reservation ${b.booking_ref} was already cancelled. Its mock payment was marked refunded; no real funds were moved.` });
      }
      await conn.commit();
      const current = await getBooking(req.params.ref);
      const notifications = await queueCancellationNotifications(b.booking_ref, current);
      const refundText = current?.refundStatus === 'REFUNDED'
        ? `Its mock refund is marked refunded (INR ${Number(current.amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}); no real money was moved.`
        : `Current refund status: ${current?.refundStatus || 'unknown'}.`;
      return res.json({ demo: true, booking: current, notifications, message: `Booking ${b.booking_ref} was already cancelled. ${refundText}` });
    }
    const [refundRows] = await conn.execute<any[]>('SELECT id,status,amount FROM refunds WHERE booking_ref=? ORDER BY id DESC LIMIT 1', [b.booking_ref]);
    const [paymentRows] = await conn.execute<any[]>("SELECT id,provider,provider_reference,status FROM transactions WHERE booking_ref=? AND status IN ('SUCCESS','PAID','SIMULATED_SUCCESS') ORDER BY id DESC LIMIT 1", [b.booking_ref]);
    const payment = paymentRows[0];
    await conn.execute('UPDATE bookings SET status=? WHERE booking_ref=?', ['CANCELLED (DEMO)', b.booking_ref]);
    if (b.flight_id) await conn.execute('UPDATE flights SET seats_available=seats_available+? WHERE id=?', [b.passenger_count, b.flight_id]);
    await conn.commit();

    let refundMessage = 'No successful payment was recorded, so no refund was initiated.';
    if (payment && !refundRows[0]) {
      try {
        const amount = Number(b.total_amount);
        const refund = await getPaymentProvider(payment.provider).refund({ bookingRef: b.booking_ref, amount, transactionId: payment.id, providerReference: payment.provider_reference || undefined });
        const [inserted]: any = await pool.execute("INSERT INTO refunds(booking_ref,transaction_id,amount,currency,status,reason,provider_reference) VALUES(?,?,?,'INR',?,?,?)", [b.booking_ref, payment.id, amount, refund.status, 'Customer requested cancellation', refund.id]);
        await pool.execute('UPDATE bookings SET refund_status=? WHERE booking_ref=?', [refund.status, b.booking_ref]);
        refundMessage = refund.status === 'REFUNDED'
          ? `Refund of ₹${amount.toLocaleString('en-IN')} has been processed in the demo payment provider (reference ${refund.id}). No real money was moved.`
          : `Refund of ₹${amount.toLocaleString('en-IN')} has been submitted and is processing (reference ${refund.id}). This demo cannot confirm a real-world bank credit.`;
      } catch (refundError) {
        await pool.execute("INSERT INTO refunds(booking_ref,transaction_id,amount,currency,status,reason) VALUES(?,?,?,'INR','FAILED',?)", [b.booking_ref, payment.id, Number(b.total_amount), 'Cancellation refund could not be confirmed by the payment provider']);
        await pool.execute('UPDATE bookings SET refund_status=? WHERE booking_ref=?', ['FAILED', b.booking_ref]);
        refundMessage = 'The reservation was cancelled, but the payment provider did not confirm a refund. The refund is marked FAILED for follow-up; no successful refund is being claimed.';
      }
    }
    const current = await getBooking(req.params.ref);
    const notifications = await queueCancellationNotifications(b.booking_ref, current);
    res.json({ demo: true, booking: current, notifications, message: `Reservation ${b.booking_ref} is cancelled. ${refundMessage}` });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(500).json({ error: 'Request failed. Check server logs for the request ID.' });
  } finally { conn.release(); }
});

router.post('/api/bookings/:ref/checkin', zodParams({ ref: z.string().min(4).max(40) }), async (req, res) => { try { const b = await getBooking(req.params.ref); if (!b) return res.status(404).json({ error: 'Booking not found.' }); if (b.status.startsWith('CANCELLED')) return res.status(400).json({ error: 'Cancelled bookings cannot check in.' }); const [departureRows]: any = await pool.execute('SELECT f.departure_at FROM bookings b JOIN flights f ON f.id=b.flight_id WHERE b.booking_ref=?', [req.params.ref.toUpperCase()]); const hoursUntil = (new Date(departureRows[0].departure_at).getTime() - Date.now()) / 3600000; if (hoursUntil > 48 || hoursUntil < 1) return res.status(400).json({ error: 'Web check-in opens 48 hours before departure and closes 1 hour before departure.', hoursUntilDeparture: Math.round(hoursUntil * 10) / 10 }); await pool.execute('UPDATE bookings SET checked_in=TRUE WHERE booking_ref=?', [req.params.ref.toUpperCase()]); const pass = `SKYMATE DEMO BOARDING PASS\nBooking: ${b.ref}\nFlight: ${b.flight.flightNo}\nRoute: ${b.flight.from} -> ${b.flight.to}\nPassengers: ${b.names.join(', ')}\nSeats: ${b.seats.join(', ')}\nDEMO ONLY — NOT VALID FOR TRAVEL`; res.json({ demo: true, booking: await getBooking(req.params.ref), boardingPass: pass }) ;} catch (e) { res.status(500).json({ error: 'Request failed. Check server logs for the request ID.' }) ;} });

router.get('/api/bookings/:ref/boarding-pass.pdf', zodParams({ ref: z.string().min(4).max(40) }), async (req, res) => {
  try {
    const booking = await getBooking(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (!booking.checkedIn) return res.status(409).json({ error: 'Complete web check-in before downloading the demo boarding pass.' });
    if (booking.status.startsWith('CANCELLED')) return res.status(400).json({ error: 'Cancelled bookings do not have a boarding pass.' });
    const qr = await QRCode.toDataURL(JSON.stringify({ demo: true, bookingRef: booking.ref, flight: booking.flight.flightNo, route: `${booking.flight.from}-${booking.flight.to}` }));
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `SkyMate demo boarding pass ${booking.ref}`, Author: 'SkyMate' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${booking.ref}-demo-boarding-pass.pdf"`);
    doc.pipe(res);
    doc.fontSize(24).fillColor('#1d4ed8').text('SkyMate · Demo Boarding Pass');
    doc.moveDown().fontSize(13).fillColor('#111827');
    doc.text(`Booking reference: ${booking.ref}`);
    doc.text(`Passenger(s): ${booking.names.join(', ') || 'Not provided'}`);
    doc.text(`Flight: ${booking.flight.airline} ${booking.flight.flightNo}`);
    doc.text(`Route: ${booking.flight.from} → ${booking.flight.to}`);
    doc.text(`Departure: ${booking.flight.departureAt || booking.flight.departure || 'Not provided'}`);
    doc.text(`Arrival: ${booking.flight.arrivalAt || booking.flight.arrival || 'Not provided'}`);
    doc.text(`Seats: ${booking.seats.join(', ') || 'Not assigned'}`);
    doc.image(qr, 48, 330, { width: 112, height: 112 });
    doc.fontSize(11).fillColor('#b91c1c').text('DEMO DOCUMENT — NOT VALID FOR AIRLINE TRAVEL', 48, 470, { width: 500, align: 'center' });
    doc.end();
  } catch {
    if (!res.headersSent) res.status(500).json({ error: 'Could not generate the demo boarding pass.' });
  }
});

router.post('/api/support', zodBody({ message: z.string().trim().min(4).max(4000), email: z.string().email().max(254).optional().or(z.literal('')) }), async (req, res) => { const message = String(req.body?.message || '').trim(), email = String(req.body?.email || ''); if (message.length < 4) return res.status(400).json({ error: 'Please describe the issue in at least 4 characters.' }); try { const id = 'SUP-' + crypto.randomBytes(3).toString('hex').toUpperCase(); await pool.execute('INSERT INTO support_tickets(email,message,status) VALUES(?,?,?)', [email, message, 'OPEN']); res.status(201).json({ demo: true, ticket: { id, message, email, status: 'OPEN' }, message: 'Support ticket saved in MySQL. No external agent has been contacted.' }) ;} catch (e) { res.status(500).json({ error: 'Request failed. Check server logs for the request ID.' }) ;} });

router.get('/api/admin/summary', requireAuth, requireRole('admin', 'support'), async (_req, res) => { try { const [[b]]: any = await pool.query('SELECT COUNT(*) bookings, SUM(status LIKE \'CONFIRMED%\') confirmed, SUM(status LIKE \'CANCELLED%\') cancelled, SUM(CASE WHEN status LIKE \'CONFIRMED%\' THEN total_amount ELSE 0 END) revenue FROM bookings'); const [[t]]: any = await pool.query('SELECT COUNT(*) tickets FROM support_tickets'); const [[u]]: any = await pool.query('SELECT COUNT(*) users FROM users'); res.json({ demo: true, users: u.users, bookings: b.bookings, confirmed: b.confirmed, cancelled: b.cancelled, supportTickets: t.tickets, revenue: Number(b.revenue || 0) }) ;} catch (e) { res.status(500).json({ error: 'Request failed. Check server logs for the request ID.' }) ;} });

router.post('/api/chat', zodBody({ message: z.string().trim().min(1).max(2000), sessionId: z.string().min(8).max(120).optional(), trip_type: z.enum(['one_way','round_trip']).optional(), passengers: z.coerce.number().int().min(1).max(9).optional() }), async (req, res) => { const message = String(req.body?.message || '').trim(); if (!message || message.length > 2000) return res.status(400).json({ error: 'Message is required (maximum 2000 characters).' }); const sessionId = String(req.body?.sessionId || crypto.randomUUID()); try { await pool.execute('INSERT INTO conversations(session_id) VALUES(?) ON DUPLICATE KEY UPDATE updated_at=CURRENT_TIMESTAMP', [sessionId]); const [cs]: any = await pool.execute('SELECT id FROM conversations WHERE session_id=?', [sessionId]); await pool.execute('INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)', [cs[0].id, 'user', message]); const base = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, ''); const r = await fetch(`${base}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, conversation_id: sessionId, trip_type: req.body.trip_type, passengers: req.body.passengers }) }); const d: any = await r.json(); if (!r.ok) return res.status(r.status).json(d); await pool.execute('INSERT INTO messages(conversation_id,role,content,intent,entities) VALUES(?,?,?,?,?)', [cs[0].id, 'assistant', String(d.reply || ''), String(d.intent || 'faq'), JSON.stringify(d.entities || {})]); await pool.execute('INSERT INTO analytics_events(session_id,event_name,properties) VALUES(?,?,?)', [sessionId, 'chat_message', JSON.stringify({ intent: d.intent || 'faq' })]); res.json({ demo: true, intent: d.intent, entities: d.entities, reply: d.reply, nextAction: d.next_action, sessionId: d.conversation_id, toolResult: d.tool_result ?? null, demoMode: true, aiMode: 'python-langgraph' }) ;} catch { res.status(503).json({ error: 'Chat persistence or Python AI service unavailable. Check backend logs and readiness.' }) ;} });

export default router;
