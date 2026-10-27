import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'mysql2/promise';
import type Redis from 'ioredis';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { getPaymentProvider } from '../adapters/paymentProvider';
import { enqueueNotification } from '../services/notificationQueue';
import { createWeatherAdapter } from '../adapters/weatherAdapter';
import { createCurrencyAdapter } from '../adapters/currencyAdapter';
import { createAirlineAdapter } from '../adapters/airlineAdapter';
import { createEmailAdapter } from '../adapters/emailAdapter';
import { createSmsAdapter } from '../adapters/smsAdapter';
import { createWhatsAppAdapter } from '../adapters/whatsappAdapter';
import { verifyRazorpaySignature } from '../adapters/paymentProvider';

const router=Router();
const body=(schema:z.ZodTypeAny)=>(req:Request,res:Response,next:NextFunction)=>{const r=schema.safeParse(req.body??{});if(!r.success)return res.status(400).json({error:'Validation failed',issues:r.error.issues});req.body=r.data;next()};
const query=(schema:z.ZodTypeAny)=>(req:Request,res:Response,next:NextFunction)=>{const r=schema.safeParse(req.query);if(!r.success)return res.status(400).json({error:'Validation failed',issues:r.error.issues});next()};
const secret=()=>{const s=process.env.JWT_SECRET||'';if(s.length<32)throw new Error('JWT_SECRET must be at least 32 characters');return s};
const token=(id:string,role:string,email:string|null,extra:Record<string,unknown>={})=>jwt.sign({sub:id,role,email,...extra},secret(),{expiresIn:'15m'});
const refreshToken=(id:string)=>jwt.sign({sub:id,type:'refresh',jti:crypto.randomUUID()},secret(),{expiresIn:'7d'});
let db:Pool,redis:Redis;
export function configureAdvancedApi(deps:{pool:Pool;redis:Redis}){db=deps.pool;redis=deps.redis;return router;}
router.use((req,res,next)=>{const parsed=z.record(z.string().max(120)).safeParse(req.params);if(!parsed.success)return res.status(400).json({error:'Invalid path parameters.'});next()});
async function audit(actor:string|number|null,action:string,type:string,id:string|number|null,details:unknown={}){await db.execute('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,details) VALUES(?,?,?,?,?)',[actor||null,action,type,id==null?null:String(id),JSON.stringify(details)]).catch(()=>undefined)}

// Phase 1: accounts, guest sessions, refresh tokens and profile.
router.post('/api/auth/register',body(z.object({name:z.string().trim().min(2).max(255),email:z.string().email().max(254),password:z.string().min(8).max(128),phone:z.string().min(7).max(32).optional()})),async(req,res)=>{const {name,email,password,phone}=req.body;const hash=await bcrypt.hash(password,12);try{const [r]:any=await db.execute('INSERT INTO users(full_name,email,phone,password_hash,role,email_verified) VALUES(?,?,?,?,\'customer\',FALSE)',[name,email.toLowerCase(),phone||null,hash]);res.status(201).json({ok:true,user:{id:String(r.insertId),name,email:email.toLowerCase()},message:'Account created. Verify your email to enable verified-account features.'});}catch(e:any){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Email or phone already registered.'});throw e;}});
router.post('/api/auth/login',body(z.object({email:z.string().email().max(254),password:z.string().min(1).max(128)})),async(req,res)=>{const email=req.body.email.toLowerCase();const [rows]:any=await db.execute('SELECT id,email,full_name,role,password_hash,is_blocked FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||!u.password_hash||!(await bcrypt.compare(req.body.password,u.password_hash)))return res.status(401).json({error:'Invalid email or password.'});if(u.is_blocked)return res.status(403).json({error:'Account is blocked.'});const accessToken=token(String(u.id),u.role,u.email);const refresh=refreshToken(String(u.id));await redis.set(`refresh:${crypto.createHash('sha256').update(refresh).digest('hex')}`,String(u.id),'EX',604800);res.cookie('skymate_refresh',refresh,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:604800000,path:'/api/auth'});res.json({ok:true,token:accessToken,user:{id:String(u.id),email:u.email,name:u.full_name,role:u.role}})});
router.post('/api/auth/refresh',async(req,res)=>{const r=req.cookies?.skymate_refresh as string|undefined;if(!r)return res.status(401).json({error:'Refresh cookie required.'});try{const p=jwt.verify(r,secret()) as jwt.JwtPayload;if(p.type!=='refresh'||!p.sub)throw new Error('invalid');const key=`refresh:${crypto.createHash('sha256').update(r).digest('hex')}`;if(!await redis.get(key))return res.status(401).json({error:'Refresh token revoked.'});const [rows]:any=await db.execute('SELECT id,email,role,is_blocked FROM users WHERE id=?',[p.sub]);if(!rows[0]||rows[0].is_blocked)return res.status(401).json({error:'Account unavailable.'});res.json({token:token(String(rows[0].id),rows[0].role,rows[0].email)});}catch{return res.status(401).json({error:'Invalid refresh token.'})}});
router.post('/api/auth/logout',async(req,res)=>{const r=req.cookies?.skymate_refresh as string|undefined;if(r)await redis.del(`refresh:${crypto.createHash('sha256').update(r).digest('hex')}`);res.clearCookie('skymate_refresh',{path:'/api/auth'});res.json({ok:true})});
router.post('/api/auth/guest-session',body(z.object({name:z.string().trim().min(2).max(120),email:z.string().email().max(254).optional(),phone:z.string().min(7).max(32).optional()})),async(req,res)=>{const id=`guest-${crypto.randomUUID()}`;const session={id,name:req.body.name,email:req.body.email||null,phone:req.body.phone||null,createdAt:new Date().toISOString()};await redis.set(`guest:${id}`,JSON.stringify(session),'EX',43200);res.status(201).json({ok:true,guest:session,token:token(id,'customer',session.email,{guest:true})})});
router.post('/api/auth/claim-bookings',requireAuth,body(z.object({email:z.string().email().max(254)})),async(req,res)=>{if(req.auth?.guest)return res.status(400).json({error:'Register or verify an account before claiming bookings.'});const [r]:any=await db.execute('UPDATE bookings SET user_id=? WHERE email=? AND user_id IS NULL',[req.auth?.sub,req.body.email.toLowerCase()]);res.json({claimed:r.affectedRows})});
router.get('/api/profile', requireAuth, async (req, res) => {
  if (req.auth?.guest) {
    return res.json({
      user: { id: req.auth.sub, role: 'customer', guest: true },
      bookings: []
    });
  }

  const userId = req.auth?.sub;
  if (userId === undefined || userId === null) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const [users]: any = await db.execute(
    'SELECT id,email,phone,full_name,role,email_verified,phone_verified,created_at FROM users WHERE id=?',
    [userId]
  );
  if (!users[0]) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const [bookings]: any = await db.execute(
    'SELECT booking_ref,status,total_amount,created_at FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
    [userId]
  );
  return res.json({ user: users[0], bookings });
});

router.post('/api/auth/forgot-password',body(z.object({email:z.string().email().max(254)})),async(req,res)=>{const email=req.body.email.toLowerCase();const [rows]:any=await db.execute('SELECT id FROM users WHERE email=?',[email]);if(!rows[0])return res.json({ok:true,message:'If the account exists, a reset code has been sent.'});const key=`password-reset:${email}`;const sent=Number(await redis.get(`${key}:sent`)||0);if(sent>=3)return res.status(429).json({error:'Reset resend limit reached. Try again later.'});const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');await redis.set(key,crypto.createHash('sha256').update(`${email}:${code}:${secret()}`).digest('hex'),'EX',300);await redis.multi().incr(`${key}:sent`).expire(`${key}:sent`,3600).exec();if(process.env.EMAIL_PROVIDER!==='mock'){const {createEmailAdapter}=await import('../adapters/emailAdapter.js');await createEmailAdapter().sendOtp(email,code)}else console.info(JSON.stringify({event:'mock_password_reset',email,code}));res.json({ok:true,message:'If the account exists, a reset code has been sent. Mock mode writes the code to backend logs.'})});
router.post('/api/auth/reset-password',body(z.object({email:z.string().email().max(254),code:z.string().regex(/^\d{6}$/),password:z.string().min(8).max(128)})),async(req,res)=>{const email=req.body.email.toLowerCase();const key=`password-reset:${email}`;const saved=await redis.get(key);const expected=crypto.createHash('sha256').update(`${email}:${req.body.code}:${secret()}`).digest('hex');if(!saved||!crypto.timingSafeEqual(Buffer.from(saved),Buffer.from(expected)))return res.status(400).json({error:'Reset code is invalid or expired.'});const hash=await bcrypt.hash(req.body.password,12);const [r]:any=await db.execute('UPDATE users SET password_hash=? WHERE email=?',[hash,email]);await redis.del(key);if(!r.affectedRows)return res.status(400).json({error:'Account not found.'});res.json({ok:true,message:'Password reset successfully.'})});
router.post('/api/auth/phone-otp',requireAuth,body(z.object({phone:z.string().min(7).max(32)})),async(req,res)=>{const phone=req.body.phone;const count=Number(await redis.get(`phone-otp-count:${req.auth?.sub}`)||0);if(count>=3)return res.status(429).json({error:'OTP resend limit reached.'});const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');await redis.set(`phone-otp:${req.auth?.sub}`,crypto.createHash('sha256').update(`${phone}:${code}:${secret()}`).digest('hex'),'EX',300);await redis.multi().incr(`phone-otp-count:${req.auth?.sub}`).expire(`phone-otp-count:${req.auth?.sub}`,3600).exec();try{const {createSmsAdapter}=await import('../adapters/smsAdapter.js');await createSmsAdapter().send(phone,`Your SkyMate verification code is ${code}. It expires in 5 minutes.`);res.json({ok:true,message:process.env.SMS_PROVIDER==='twilio'?'SMS OTP sent through Twilio.':'Mock SMS OTP logged by backend.'})}catch(e){await redis.del(`phone-otp:${req.auth?.sub}`);res.status(502).json({error:e instanceof Error?e.message:'SMS provider failed.'})}});
router.post('/api/auth/phone-otp/verify',requireAuth,body(z.object({phone:z.string().min(7).max(32),code:z.string().regex(/^\d{6}$/)})),async(req,res)=>{const key=`phone-otp:${req.auth?.sub}`;const saved=await redis.get(key);const expected=crypto.createHash('sha256').update(`${req.body.phone}:${req.body.code}:${secret()}`).digest('hex');if(!saved||!crypto.timingSafeEqual(Buffer.from(saved),Buffer.from(expected)))return res.status(400).json({error:'OTP invalid or expired.'});await db.execute('UPDATE users SET phone=?,phone_verified=TRUE WHERE id=?',[req.body.phone,req.auth?.sub]);await redis.del(key);res.json({ok:true,phoneVerified:true})});

// Phase 2: airports, fares, flight search, seat maps and ten-minute holds.
router.get('/api/airports',query(z.object({q:z.string().trim().min(1).max(100).optional()})),async(req,res)=>{const q=String(req.query.q||'');const [rows]:any=await db.execute('SELECT code,city,name,country FROM airports WHERE active=1 AND (?=\'\' OR code LIKE ? OR city LIKE ? OR name LIKE ?) ORDER BY city LIMIT 25',[q,`%${q}%`,`%${q}%`,`%${q}%`]);res.json({airports:rows})});
router.get('/api/search',query(z.object({from:z.string().length(3),to:z.string().length(3),departDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),returnDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),adults:z.coerce.number().int().min(1).max(9).default(1),children:z.coerce.number().int().min(0).max(8).default(0),infants:z.coerce.number().int().min(0).max(4).default(0),cabin:z.enum(['economy','premium_economy','business']).default('economy'),airline:z.string().max(100).optional(),maxPrice:z.coerce.number().positive().optional(),stops:z.enum(['any','nonstop']).default('any')})),async(req,res)=>{const raw=req.query as any;const q={...raw,adults:Number(raw.adults||1),children:Number(raw.children||0),infants:Number(raw.infants||0),cabin:raw.cabin||'economy',stops:raw.stops||'any'};const total=q.adults+q.children;if(q.infants>q.adults)return res.status(400).json({error:'Infants cannot exceed the number of adults.'});const find=async(from:string,to:string,date:string)=>{let sql=`SELECT f.*,fi.id instance_id,fi.premium_economy_fare,fi.status instance_status,fi.gate,fi.aircraft_type FROM flights f LEFT JOIN flight_instances fi ON fi.flight_id=f.id AND fi.flight_date=? WHERE f.departure_code=? AND f.arrival_code=? AND DATE(f.departure_at)=? AND f.seats_available>=? AND f.status NOT LIKE 'CANCELLED%'`;const args:any[]=[date,from.toUpperCase(),to.toUpperCase(),date,total];if(q.airline){sql+=' AND f.airline=?';args.push(q.airline)}if(q.maxPrice){const col=q.cabin==='business'?'f.business_fare':q.cabin==='premium_economy'?'fi.premium_economy_fare':'f.economy_fare';sql+=` AND ${col}<=?`;args.push(q.maxPrice)}sql+=' ORDER BY f.departure_at LIMIT 100';const [rows]:any=await db.execute(sql,args);return rows.map((f:any)=>({...f,price:Number(q.cabin==='business'?f.business_fare:q.cabin==='premium_economy'?f.premium_economy_fare:f.economy_fare),seatsAvailable:Number(f.seats_available)}))};const outbound=await find(q.from,q.to,q.departDate);const inbound=q.returnDate?await find(q.to,q.from,q.returnDate):[];res.json({outbound,returnFlights:inbound,roundTrip:!!q.returnDate,passengers:{adults:q.adults,children:q.children,infants:q.infants},recommendations:{cheapest:[...outbound].sort((a:any,b:any)=>a.price-b.price)[0]||null,fastest:[...outbound].sort((a:any,b:any)=>(new Date(a.arrival_at).getTime()-new Date(a.departure_at).getTime())-(new Date(b.arrival_at).getTime()-new Date(b.departure_at).getTime()))[0]||null}})});
router.get('/api/flights/:id/seats',query(z.object({cabin:z.enum(['economy','premium_economy','business']).optional()})),async(req,res)=>{const [rows]:any=await db.execute('SELECT fi.id instance_id FROM flight_instances fi WHERE fi.flight_id=? ORDER BY fi.flight_date LIMIT 1',[req.params.id]);if(!rows[0])return res.status(404).json({error:'Flight instance not found.'});const [seats]:any=await db.execute('SELECT id,seat_number,cabin,type,status,price_modifier FROM seats WHERE flight_instance_id=? AND (? IS NULL OR cabin=?) ORDER BY CAST(seat_number AS UNSIGNED),seat_number',[rows[0].instance_id,req.query.cabin||null,req.query.cabin||null]);res.json({flightInstanceId:rows[0].instance_id,seats})});
router.post('/api/seats/hold',requireAuth,body(z.object({flightInstanceId:z.coerce.number().int().positive(),seatIds:z.array(z.coerce.number().int().positive()).min(1).max(9)})),async(req,res)=>{const owner=String(req.auth?.sub);const key=`seat-hold:${req.body.flightInstanceId}:${req.body.seatIds.slice().sort((a:number,b:number)=>a-b).join(',')}`;const acquired=await redis.set(key,owner,'EX',600,'NX');if(!acquired)return res.status(409).json({error:'These seats are currently held by another checkout.'});const conn=await db.getConnection();try{await conn.beginTransaction();const [rows]:any=await conn.query(`SELECT id,status,hold_expires_at FROM seats WHERE flight_instance_id=? AND id IN (${req.body.seatIds.map(()=>'?').join(',')}) FOR UPDATE`,[req.body.flightInstanceId,...req.body.seatIds]);if(rows.length!==req.body.seatIds.length||rows.some((s:any)=>s.status==='BOOKED'||s.status==='BLOCKED'||(s.status==='HELD'&&s.hold_expires_at&&new Date(s.hold_expires_at)>new Date()))){await conn.rollback();await redis.del(key);return res.status(409).json({error:'One or more seats are unavailable.'})}await conn.execute(`UPDATE seats SET status='HELD',hold_expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE) WHERE flight_instance_id=? AND id IN (${req.body.seatIds.map(()=>'?').join(',')})`,[req.body.flightInstanceId,...req.body.seatIds]);await conn.commit();res.status(201).json({held:req.body.seatIds,expiresInSeconds:600,holdKey:key})}catch(e){await conn.rollback();await redis.del(key);throw e}finally{conn.release()}});
router.get('/api/fares/:flightId',async(req,res)=>{const [rows]:any=await db.execute('SELECT * FROM flights WHERE id=?',[req.params.flightId]);if(!rows[0])return res.status(404).json({error:'Flight not found.'});const f=rows[0];res.json({flightId:f.id,fares:[{family:'Saver',cabin:'economy',price:Number(f.economy_fare),baggage:'15 kg checked; 7 kg cabin (demo policy)',changes:'Fee applies',refundable:false},{family:'Flex',cabin:'economy',price:Number(f.economy_fare)*1.25,baggage:'20 kg checked; 7 kg cabin (demo policy)',changes:'One change fee waived',refundable:true},{family:'Business',cabin:'business',price:Number(f.business_fare),baggage:'30 kg checked; 7 kg cabin (demo policy)',changes:'Changes permitted subject to fare rules',refundable:true}],notice:'Illustrative demo fare rules; verify real airline rules before travel.'})});
router.post('/api/coupons/validate',body(z.object({code:z.string().trim().min(3).max(40),amount:z.coerce.number().positive()})),async(req,res)=>{const [rows]:any=await db.execute('SELECT * FROM coupons WHERE code=? AND active=1 AND starts_at<=NOW() AND ends_at>=NOW() AND min_order_value<=?',[req.body.code.toUpperCase(),req.body.amount]);if(!rows[0])return res.status(400).json({valid:false,error:'Coupon is invalid, expired, or does not meet the minimum order.'});const c=rows[0];const discount=Math.min(Number(c.max_discount||Infinity),c.discount_type==='PERCENT'?req.body.amount*Number(c.discount_value)/100:Number(c.discount_value));res.json({valid:true,code:c.code,discount:Math.round(discount*100)/100,total:Math.max(0,req.body.amount-discount)})});

// Phase 3: mock payment, idempotency and refunds. No card details are accepted or stored.
router.post('/api/payments/order',requireAuth,body(z.object({bookingRef:z.string().min(4).max(40),currency:z.string().length(3).default('INR'),idempotencyKey:z.string().min(8).max(120)})),async(req,res)=>{const [rows]:any=await db.execute('SELECT booking_ref,total_amount,payment_status FROM bookings WHERE booking_ref=?',[req.body.bookingRef.toUpperCase()]);if(!rows[0])return res.status(404).json({error:'Booking not found.'});const b=rows[0];const [existing]:any=await db.execute('SELECT * FROM transactions WHERE idempotency_key=?',[req.body.idempotencyKey]);if(existing[0])return res.json({order:{id:existing[0].provider_reference,bookingRef:b.booking_ref,amount:Number(existing[0].amount),currency:existing[0].currency,status:existing[0].status},idempotent:true});const order=await getPaymentProvider().createOrder({bookingRef:b.booking_ref,amount:Number(b.total_amount),currency:req.body.currency.toUpperCase(),idempotencyKey:req.body.idempotencyKey});await db.execute('INSERT INTO transactions(booking_ref,provider,amount,currency,status,provider_reference,idempotency_key) VALUES(?,?,?,?,?,?,?)',[b.booking_ref,process.env.PAYMENT_PROVIDER||'mock',order.amount,order.currency,order.status==='paid'?'SUCCESS':'CREATED',order.id,req.body.idempotencyKey]);if(order.status==='paid')await db.execute('UPDATE bookings SET payment_status=\'PAID\',status=\'CONFIRMED\' WHERE booking_ref=?',[b.booking_ref]);res.status(201).json({order,demo:(process.env.PAYMENT_PROVIDER||'mock')==='mock',notice:(process.env.PAYMENT_PROVIDER||'mock')==='mock'?'Mock payment does not charge money.':`Provider order created using ${(process.env.PAYMENT_PROVIDER||'mock').toLowerCase()} test/live credentials; complete checkout and verify the provider payment before confirming booking.`})});
router.post('/api/payments/webhook',body(z.object({eventId:z.string().min(8).max(120),type:z.enum(['payment.succeeded','payment.failed']),bookingRef:z.string().min(4).max(40),providerReference:z.string().min(4).max(255),amount:z.coerce.number().positive(),currency:z.string().length(3).default('INR')})),async(req,res)=>{const signature=String(req.headers['x-payment-signature']||'');const webhookSecret=process.env.PAYMENT_WEBHOOK_SECRET||secret();const expected=crypto.createHmac('sha256',webhookSecret).update(JSON.stringify(req.body)).digest('hex');if(!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).json({error:'Invalid payment webhook signature.'});const eventKey=`webhook:${req.body.eventId}`;const [seen]:any=await db.execute('SELECT id FROM transactions WHERE idempotency_key=?',[eventKey]);if(seen[0])return res.json({ok:true,duplicate:true});const [bookingRows]:any=await db.execute('SELECT booking_ref FROM bookings WHERE booking_ref=?',[req.body.bookingRef.toUpperCase()]);if(!bookingRows[0])return res.status(404).json({error:'Booking not found.'});const status=req.body.type==='payment.succeeded'?'SUCCESS':'FAILED';await db.execute('INSERT INTO transactions(booking_ref,provider,amount,currency,status,provider_reference,idempotency_key) VALUES(?,?,?,?,?,?,?)',[req.body.bookingRef.toUpperCase(),process.env.PAYMENT_PROVIDER||'mock',req.body.amount,req.body.currency.toUpperCase(),status,req.body.providerReference,eventKey]);await db.execute("UPDATE bookings SET payment_status=?,status=CASE WHEN ?='SUCCESS' THEN 'CONFIRMED' ELSE status END WHERE booking_ref=?",[status,status,req.body.bookingRef.toUpperCase()]);res.json({ok:true,processed:true,status})});
router.post('/api/bookings/:ref/refund',requireAuth,body(z.object({reason:z.string().trim().min(3).max(500).default('Customer requested cancellation'),amount:z.coerce.number().positive().optional()})),async(req,res)=>{const [rows]:any=await db.execute('SELECT * FROM bookings WHERE booking_ref=?',[req.params.ref.toUpperCase()]);const b=rows[0];if(!b)return res.status(404).json({error:'Booking not found.'});const amount=Math.min(Number(b.total_amount),Number(req.body.amount||b.total_amount));const [ins]:any=await db.execute('INSERT INTO refunds(booking_ref,amount,currency,status,reason) VALUES(?,?,\'INR\',\'REQUESTED\',?)',[b.booking_ref,amount,req.body.reason]);const [txRows]:any=await db.execute("SELECT provider_reference FROM transactions WHERE booking_ref=? AND status IN ('SUCCESS','PAID') ORDER BY id DESC LIMIT 1",[b.booking_ref]);const result=await getPaymentProvider().refund({bookingRef:b.booking_ref,amount,providerReference:txRows[0]?.provider_reference});await db.execute('UPDATE refunds SET status=?,provider_reference=? WHERE id=?',[result.status, result.id,ins.insertId]);await db.execute('UPDATE bookings SET refund_status=? WHERE booking_ref=?',[result.status,b.booking_ref]);res.status(201).json({refund:{id:ins.insertId,bookingRef:b.booking_ref,amount,status:result.status,reason:req.body.reason,timeline:[{status:'REQUESTED',at:new Date().toISOString()},{status:result.status,at:new Date().toISOString()}]},demo:true})});
router.get('/api/refunds/:ref',requireAuth,async(req,res)=>{const [rows]:any=await db.execute('SELECT id,booking_ref,amount,currency,status,reason,created_at,updated_at FROM refunds WHERE booking_ref=? ORDER BY created_at DESC',[req.params.ref.toUpperCase()]);res.json({refunds:rows})});

// Phase 4: notification audit, mock SMS/WhatsApp and logs.
router.post('/api/notifications/test',requireAuth,body(z.object({channel:z.enum(['email','sms','whatsapp']),to:z.string().min(3).max(254),template:z.string().min(1).max(100),message:z.string().min(1).max(1000)})),async(req,res)=>{const {channel,to,template,message}=req.body;const job=await enqueueNotification({channel,to,template,subject:`SkyMate ${template}`,message});res.status(202).json({accepted:true,channel,status:'QUEUED',jobId:job.id,notice:channel==='email'?'Email is delivered through configured SMTP/MailHog.':'SMS/WhatsApp are queued and use the mock adapter until real provider adapters are configured.'})});

// Phase 5: FAQ retrieval and weather/currency adapter-ready tools.
router.get('/api/policy/search',query(z.object({q:z.string().trim().min(2).max(250)})),async(req,res)=>{const q=String(req.query.q);const [rows]:any=await db.execute('SELECT id,title,category,content FROM faq_documents WHERE active=1 AND (MATCH(title,content) AGAINST(? IN NATURAL LANGUAGE MODE) OR title LIKE ? OR content LIKE ?) LIMIT 8',[q,`%${q}%`,`%${q}%`]);res.json({query:q,documents:rows,mode:'mysql-fulltext-plus-like',notice:'Answers are grounded in seeded policy documents; no matching document means ask support.'})});
router.get('/api/weather',query(z.object({city:z.string().min(2).max(120)})),async(req,res)=>{try{res.json(await createWeatherAdapter().forecast(String(req.query.city)))}catch(e){res.status(502).json({error:e instanceof Error?e.message:'Weather service unavailable.'})}});
router.get('/api/currency',query(z.object({from:z.string().length(3).default('INR'),to:z.string().length(3).default('USD'),amount:z.coerce.number().positive().max(1e9).default(1)})),async(req,res)=>{const raw=req.query as any;const q={from:String(raw.from||'INR').toUpperCase(),to:String(raw.to||'USD').toUpperCase(),amount:Number(raw.amount||1)};const key=`fx:${q.from}:${q.to}`;let rate=await redis.get(key);let provider='redis-cache';if(!rate){try{const result=await createCurrencyAdapter().rate(q.from,q.to);rate=String(result.rate);provider=result.provider;await redis.set(key,rate,'EX',3600)}catch{const fallback:Record<string,number>={'INR:USD':0.012,'USD:INR':83.3,'INR:EUR':0.011,'EUR:INR':90.0};rate=String(fallback[`${q.from}:${q.to}`]||1);provider='static-fallback'}}res.json({from:q.from,to:q.to,amount:q.amount,rate:Number(rate),converted:Math.round(q.amount*Number(rate)*100)/100,provider,notice:'Indicative only; verify rates before charging a payment.'})});

// Phase 6: persisted chat transcript. Existing /api/chat remains compatible.
router.get('/api/conversations/:sessionId/messages',requireAuth,async(req,res)=>{const [c]:any=await db.execute('SELECT id,user_id FROM conversations WHERE session_id=?',[req.params.sessionId]);if(!c[0])return res.json({messages:[]});if(c[0].user_id&&String(c[0].user_id)!==req.auth?.sub&&!['admin','support'].includes(String(req.auth?.role)))return res.status(403).json({error:'Not your conversation.'});const [messages]:any=await db.execute('SELECT role,content,intent,entities,created_at FROM messages WHERE conversation_id=? ORDER BY id',[c[0].id]);res.json({messages})});

const chatPassengerSchema=z.object({name:z.string().trim().min(2).max(120),birth:z.string().trim().min(1).max(40),gender:z.string().trim().max(30).optional(),email:z.string().email().max(254),phone:z.string().regex(/^\+\d[\d\s().-]{7,20}$/)});
const chatBookingSchema=z.object({booking:z.object({selected_offer:z.record(z.any()),trip_type:z.enum(['one_way','round_trip']),return_date:z.string().optional(),cabin_class:z.enum(['economy','premium_economy','business','first','first_class']),passengers:z.number().int().min(1).max(9),passengers_data:z.array(chatPassengerSchema).min(1).max(9)})});
router.post('/api/chat-bookings',body(chatBookingSchema),async(req,res)=>{
  const draft=req.body.booking;
  if(draft.passengers_data.length!==draft.passengers)return res.status(400).json({error:'Passenger details do not match the passenger count.'});
  const offer=draft.selected_offer;
  const sourceAmount=Number(offer.total??offer.price??0);
  const sourceCurrency=String(offer.currency||'INR').toUpperCase();
  const amount=(sourceCurrency==='GBP'?sourceAmount*Number(process.env.GBP_TO_INR_RATE||115):sourceAmount)*draft.passengers;
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'The selected offer has no valid fare.'});
  const ref='SKY-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [insert]:any=await conn.execute('INSERT INTO bookings(booking_ref,flight_id,passenger_count,cabin_class,seats,passenger_details,total_amount,status,payment_status,refund_status,email) VALUES(?,NULL,?,?,?, ?,?,?,?,\'NOT_REQUESTED\',?)',[ref,draft.passengers,draft.cabin_class,JSON.stringify([]),JSON.stringify({flight:offer,tripType:draft.trip_type,returnDate:draft.return_date||null,passengers:draft.passengers_data}),amount,'PENDING','PENDING',draft.passengers_data[0].email]);
    for(const passenger of draft.passengers_data){
      const names=passenger.name.trim().split(/\s+/);
      const dob=/^\d{4}-\d{2}-\d{2}$/.test(passenger.birth)?passenger.birth:null;
      await conn.execute('INSERT INTO passengers(booking_id,passenger_type,first_name,last_name,date_of_birth) VALUES(?,?,?,?,?)',[insert.insertId,'adult',names[0],names.slice(1).join(' ')||'Traveller',dob]);
    }
    await conn.commit();
    res.status(201).json({bookingRef:ref,amount,currency:String(offer.currency||'INR').toUpperCase(),paymentUrl:`/mock-payment?ref=${encodeURIComponent(ref)}`,demo:true});
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
});

router.post('/api/chat-bookings/:ref/mock-pay',async(req,res)=>{
  const ref=String(req.params.ref||'').toUpperCase();
  const conn=await db.getConnection();
  let booking:any;
  try{
    await conn.beginTransaction();
    const [rows]:any=await conn.execute('SELECT id,booking_ref,total_amount,payment_status,email,passenger_details,cabin_class FROM bookings WHERE booking_ref=? FOR UPDATE',[ref]);
    if(!rows[0]){await conn.rollback();return res.status(404).json({error:'Booking not found.'});}
    booking=rows[0];
    if(booking.payment_status!=='SIMULATED_SUCCESS'){
      const idempotencyKey=`chat-mock-${ref}`;
      const [existing]:any=await conn.execute('SELECT id FROM transactions WHERE idempotency_key=?',[idempotencyKey]);
      if(!existing[0])await conn.execute('INSERT INTO transactions(booking_ref,provider,amount,currency,status,provider_reference,idempotency_key) VALUES(?,?,?,?,?,?,?)',[ref,'mock',booking.total_amount,'INR','SIMULATED_SUCCESS',`MOCK-${crypto.randomUUID()}`,idempotencyKey]);
      await conn.execute('UPDATE bookings SET status=\'CONFIRMED (DEMO)\',payment_status=\'SIMULATED_SUCCESS\' WHERE booking_ref=?',[ref]);
    }
    await conn.commit();
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}

  let passengerData:any={};try{passengerData=typeof booking.passenger_details==='string'?JSON.parse(booking.passenger_details):booking.passenger_details;}catch{}
  const passengers=Array.isArray(passengerData?.passengers)?passengerData.passengers:[];
  const flight=passengerData?.flight||{};
  const leadPassenger=passengers[0]||{};
  const formatDateTime=(value:unknown)=>{
    if(!value)return 'Not provided';
    const parsed=new Date(String(value));
    return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(parsed)+' IST';
  };
  const flightNumber=String(flight.flightNumber||flight.flightNo||'Not provided');
  const airline=String(flight.airline||'Airline not provided');
  const origin=String(flight.departureAirport||flight.origin||'Not provided');
  const destination=String(flight.arrivalAirport||flight.destination||'Not provided');
  const departure=formatDateTime(flight.departureAt||flight.departure_at);
  const arrival=formatDateTime(flight.arrivalAt||flight.arrival_at);
  const passengerNames=passengers.map((p:any)=>String(p.name||'')).filter(Boolean).join(', ')||'Not provided';
  const returnLine=passengerData?.tripType==='round_trip'?`Return date: ${passengerData.returnDate||'Not provided'}`:null;
  const emailMessage=[
    `Hello ${String(leadPassenger.name||'traveller').split(/\s+/)[0]},`,
    '',
    `Your SkyMate mock payment was successful and booking ${ref} is confirmed.`,
    '',
    'BOOKING DETAILS',
    `Passenger(s): ${passengerNames}`,
    `Flight: ${airline} ${flightNumber}`,
    `From: ${origin}`,
    `To: ${destination}`,
    `Departure: ${departure}`,
    `Arrival: ${arrival}`,
    `Trip: ${passengerData?.tripType==='round_trip'?'Round trip':'One way'}`,
    ...(returnLine?[returnLine]:[]),
    `Cabin: ${String(booking.cabin_class||'Not provided').replace(/_/g,' ')}`,
    `Passengers: ${passengers.length}`,
    `Estimated fare: INR ${Number(booking.total_amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`,
    '',
    'CHECK-IN',
    'Airline check-in usually opens 48 hours before departure and closes 1 hour before departure. Confirm the exact window with the operating airline.',
    '',
    'This is a SkyMate demo reservation. It is not a valid airline-issued ticket or boarding pass, and no real payment was taken.',
  ].join('\n');
  const smsMessage=`SkyMate demo booking ${ref} confirmed: ${airline} ${flightNumber}, ${origin} to ${destination}, departing ${departure}. Check-in timing: verify with the airline. Demo only; not a valid ticket.`;
  const notifications:string[]=[];
  const email=booking.email||passengers[0]?.email;
  const enqueueOnce=async(key:string,job:Parameters<typeof enqueueNotification>[0],label:string)=>{const claimed=await redis.set(key,'queued','EX',60*60*24*30,'NX');if(!claimed){notifications.push(`${label} already queued`);return;}try{await enqueueNotification(job);notifications.push(`${label} queued`);}catch{await redis.del(key);notifications.push(`${label} could not be queued`);}};
  if(email)await enqueueOnce(`booking-confirmation:${ref}:email:${encodeURIComponent(email)}`,{channel:'email',to:email,template:'booking-confirmation',subject:`SkyMate booking confirmed · ${ref}`,message:emailMessage},'email');
  const phoneNumbers=[...new Set<string>(passengers.map((p:any)=>String(p.phone||'')).filter(Boolean))];
  for(const phone of phoneNumbers){const base=`booking-confirmation:${ref}:${encodeURIComponent(phone)}`;await enqueueOnce(`${base}:sms`,{channel:'sms',to:phone,template:'booking-confirmation',subject:`SkyMate booking ${ref}`,message:smsMessage},'SMS');await enqueueOnce(`${base}:whatsapp`,{channel:'whatsapp',to:phone,template:'booking-confirmation',subject:`SkyMate booking ${ref}`,message:smsMessage},'WhatsApp');}
  res.json({ok:true,demo:true,bookingRef:ref,message:`Booking ${ref} confirmed. Confirmation details have been queued for the available passenger contact channels.`,notifications});
});
