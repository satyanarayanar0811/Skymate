'use client';
import {useState} from 'react';
const API=(process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api').replace(/\/$/,'');
declare global { interface Window { Razorpay?: new (options:any)=>{open:()=>void}; } }
export default function PaymentPage(){
  const [bookingRef,setBookingRef]=useState('');const [currency,setCurrency]=useState('INR');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  async function pay(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{
    const auth=JSON.parse(localStorage.getItem('skymate-auth')||'{}');if(!auth.token)throw new Error('Please sign in first, then reopen this payment page.');
    const response=await fetch(`${API}/payments/order`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify({bookingRef:bookingRef.trim().toUpperCase(),currency,idempotencyKey:`web-${crypto.randomUUID()}`})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not create payment order.');
    const order=data.order;
    if(order.checkoutUrl){window.location.href=order.checkoutUrl;return;}
    if(order.providerKey&&order.id&&!String(order.id).startsWith('MOCK-')){
      const load=()=>new Promise<void>((resolve,reject)=>{if(window.Razorpay){resolve();return;}const s=document.createElement('script');s.src='https://checkout.razorpay.com/v1/checkout.js';s.onload=()=>resolve();s.onerror=()=>reject(new Error('Unable to load Razorpay Checkout.'));document.body.appendChild(s)});
      await load();if(!window.Razorpay)throw new Error('Razorpay Checkout unavailable.');
      const checkout=new window.Razorpay({key:order.providerKey,amount:Math.round(Number(order.amount)*100),currency:order.currency,order_id:order.id,name:'SkyMate Airline Reservations',description:`Booking ${order.bookingRef}`,handler:async(result:any)=>{const verify=await fetch(`${API}/payments/razorpay/verify`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify({bookingRef:order.bookingRef,razorpay_order_id:result.razorpay_order_id,razorpay_payment_id:result.razorpay_payment_id,razorpay_signature:result.razorpay_signature})});const v=await verify.json();if(!verify.ok)throw new Error(v.error||'Payment verification failed.');setMessage(`Payment verified for ${order.bookingRef}.`);},modal:{ondismiss:()=>setMessage('Payment checkout was closed. The booking has not been marked paid.')}});
      checkout.open();return;
    }
    setMessage(`Payment order ${order.id} was created. No charge was made because a payment provider checkout is not configured.`);
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false)}}
  return <main style={{maxWidth:680,margin:'40px auto',padding:24,fontFamily:'Arial,sans-serif'}}><a href="/">← Back to SkyMate</a><h1>Payment</h1><p>Complete checkout for an existing booking using the configured payment provider.</p><form onSubmit={pay} style={{display:'grid',gap:14}}><label>Booking reference<input required minLength={4} maxLength={40} value={bookingRef} onChange={e=>setBookingRef(e.target.value.toUpperCase())} placeholder="SKY-ABC123" /></label><label>Currency<select value={currency} onChange={e=>setCurrency(e.target.value)}><option value="INR">INR</option><option value="USD">USD</option></select></label><button disabled={busy}>{busy?'Creating order…':'Continue to payment'}</button></form>{error&&<p role="alert" style={{color:'crimson'}}>{error}</p>}{message&&<p role="status">{message}</p>}<p><small>Provider selection is configured by PAYMENT_PROVIDER in the backend environment. Never enter card details into SkyMate forms; hosted provider checkout handles payment details.</small></p></main>
}
