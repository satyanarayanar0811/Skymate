import crypto from 'node:crypto';
export type PaymentOrder = { id: string; bookingRef: string; amount: number; currency: string; status: 'created' | 'paid' | 'failed'; checkoutUrl?: string; providerKey?: string };
export interface PaymentProvider {
  createOrder(input:{bookingRef:string;amount:number;currency:string;idempotencyKey:string}):Promise<PaymentOrder>;
  refund(input:{bookingRef:string;amount:number;transactionId?:number;providerReference?:string}):Promise<{id:string;status:'REFUNDED'|'PROCESSING';amount:number}>;
}
class MockPaymentProvider implements PaymentProvider {
 async createOrder(input:{bookingRef:string;amount:number;currency:string;idempotencyKey:string}):Promise<PaymentOrder>{return {id:`MOCK-${input.idempotencyKey}`,bookingRef:input.bookingRef,amount:input.amount,currency:input.currency,status:'paid'};}
 async refund(input:{bookingRef:string;amount:number}):Promise<{id:string;status:'REFUNDED';amount:number}>{return {id:`MOCK-REF-${input.bookingRef}`,status:'REFUNDED',amount:input.amount};}
}
class StripePaymentProvider implements PaymentProvider {
 private key(){const k=process.env.STRIPE_SECRET_KEY;if(!k)throw new Error('STRIPE_SECRET_KEY is required for PAYMENT_PROVIDER=stripe. Use a Stripe test-mode secret key.');return k}
 async createOrder(i:{bookingRef:string;amount:number;currency:string;idempotencyKey:string}):Promise<PaymentOrder>{
   const params=new URLSearchParams();params.set('mode','payment');params.set('success_url',`${process.env.FRONTEND_PUBLIC_URL||'http://localhost:3000'}/booking-confirmation?session_id={CHECKOUT_SESSION_ID}`);params.set('cancel_url',`${process.env.FRONTEND_PUBLIC_URL||'http://localhost:3000'}/payment?cancelled=1`);params.set('client_reference_id',i.bookingRef);params.set('metadata[bookingRef]',i.bookingRef);params.set('line_items[0][price_data][currency]',i.currency.toLowerCase());params.set('line_items[0][price_data][unit_amount]',String(Math.round(i.amount*100)));params.set('line_items[0][price_data][product_data][name]',`SkyMate booking ${i.bookingRef}`);params.set('line_items[0][quantity]','1');
   const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${this.key()}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':i.idempotencyKey},body:params,signal:AbortSignal.timeout(15000)});const d:any=await r.json();if(!r.ok)throw new Error(`Stripe Checkout failed: ${d.error?.message||r.status}`);return {id:d.id,bookingRef:i.bookingRef,amount:i.amount,currency:i.currency,status:'created',checkoutUrl:d.url};
 }
 async refund(i:{bookingRef:string;amount:number;providerReference?:string}):Promise<{id:string;status:'PROCESSING';amount:number}>{
   const paymentIntent=i.providerReference;if(!paymentIntent)throw new Error('Stripe refund requires a provider payment-intent reference.');
   const p=new URLSearchParams({payment_intent:paymentIntent,amount:String(Math.round(i.amount*100))});const r=await fetch('https://api.stripe.com/v1/refunds',{method:'POST',headers:{authorization:`Bearer ${this.key()}`,'content-type':'application/x-www-form-urlencoded'},body:p,signal:AbortSignal.timeout(15000)});const d:any=await r.json();if(!r.ok)throw new Error(`Stripe refund failed: ${d.error?.message||r.status}`);return {id:d.id,status:'PROCESSING',amount:i.amount};
 }
}
class RazorpayPaymentProvider implements PaymentProvider {
 private auth(){const id=process.env.RAZORPAY_KEY_ID,secret=process.env.RAZORPAY_KEY_SECRET;if(!id||!secret)throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required. Use Razorpay test keys.');return 'Basic '+Buffer.from(`${id}:${secret}`).toString('base64')}
 async createOrder(i:{bookingRef:string;amount:number;currency:string;idempotencyKey:string}):Promise<PaymentOrder>{
   const r=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{authorization:this.auth(),'content-type':'application/json'},body:JSON.stringify({amount:Math.round(i.amount*100),currency:i.currency.toUpperCase(),receipt:i.bookingRef,notes:{bookingRef:i.bookingRef,idempotencyKey:i.idempotencyKey}}),signal:AbortSignal.timeout(15000)});const d:any=await r.json();if(!r.ok)throw new Error(`Razorpay order failed: ${d.error?.description||r.status}`);return {id:d.id,bookingRef:i.bookingRef,amount:i.amount,currency:i.currency,status:'created',providerKey:process.env.RAZORPAY_KEY_ID};
 }
 async refund(i:{bookingRef:string;amount:number;providerReference?:string}):Promise<{id:string;status:'PROCESSING';amount:number}>{if(!i.providerReference)throw new Error('Razorpay refund requires a payment ID as providerReference.');const r=await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(i.providerReference)}/refund`,{method:'POST',headers:{authorization:this.auth(),'content-type':'application/json'},body:JSON.stringify({amount:Math.round(i.amount*100),notes:{bookingRef:i.bookingRef}}),signal:AbortSignal.timeout(15000)});const d:any=await r.json();if(!r.ok)throw new Error(`Razorpay refund failed: ${d.error?.description||r.status}`);return {id:d.id,status:'PROCESSING',amount:i.amount};}
}
export function verifyRazorpaySignature(orderId:string,paymentId:string,signature:string):boolean{const secret=process.env.RAZORPAY_KEY_SECRET;if(!secret)return false;const expected=crypto.createHmac('sha256',secret).update(`${orderId}|${paymentId}`).digest('hex');return signature.length===expected.length&&crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected));}
export function getPaymentProvider(provider?:string):PaymentProvider {const p=(provider||process.env.PAYMENT_PROVIDER||'mock').toLowerCase();if(p==='mock')return new MockPaymentProvider();if(p==='stripe')return new StripePaymentProvider();if(p==='razorpay')return new RazorpayPaymentProvider();throw new Error(`Unsupported PAYMENT_PROVIDER=${p}. Choose mock, stripe, or razorpay.`)}
