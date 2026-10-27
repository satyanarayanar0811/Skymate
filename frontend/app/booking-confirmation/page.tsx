'use client';
import {useEffect,useState} from 'react';
const API=(process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api').replace(/\/$/,'');
export default function BookingConfirmationPage(){
 const [status,setStatus]=useState('Checking payment status…');const [ref,setRef]=useState('');
 useEffect(()=>{const params=new URLSearchParams(window.location.search);const session=params.get('session_id');if(!session){setStatus('No payment session was provided.');return;}const auth=JSON.parse(localStorage.getItem('skymate-auth')||'{}');fetch(`${API}/payments/stripe/session-status?session_id=${encodeURIComponent(session)}`,{headers:auth.token?{Authorization:`Bearer ${auth.token}`}:{}}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Payment status could not be checked.');setRef(d.bookingRef||'');setStatus(d.paymentStatus==='PAID'?'Payment confirmed. Your booking is confirmed.':`Payment status: ${d.paymentStatus||'PENDING'}. This page does not itself confirm payment.`)}).catch(e=>setStatus(e instanceof Error?e.message:'Could not check payment status.'));},[]);
 return <main style={{maxWidth:680,margin:'50px auto',padding:24,fontFamily:'Arial,sans-serif'}}><h1>Booking payment result</h1><p role="status">{status}</p>{ref&&<p>Booking reference: <strong>{ref}</strong></p>}<p>Payment confirmation is recorded by the verified provider webhook. If it remains pending, check the provider webhook configuration.</p><a href="/">Return to SkyMate</a></main>
}
