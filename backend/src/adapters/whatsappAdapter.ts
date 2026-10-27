import { getTwilioRequestAuth } from './twilioAuth';

export interface WhatsAppAdapter { send(to:string,body:string):Promise<{provider:string;messageId?:string}> }
class MockWhatsAppAdapter implements WhatsAppAdapter { async send(to:string,body:string){if(process.env.NODE_ENV==='production')throw new Error('Mock WhatsApp disabled in production');console.info(JSON.stringify({event:'mock_whatsapp',to,body:body.slice(0,300)}));return {provider:'mock'};} }
class TwilioWhatsAppAdapter implements WhatsAppAdapter {
 async send(to:string,body:string){const from=process.env.TWILIO_WHATSAPP_FROM;if(!from||from==='mock')throw new Error('Set TWILIO_WHATSAPP_FROM to an approved or sandbox WhatsApp sender.');const {accountSid,authorization}=getTwilioRequestAuth();const normalize=(n:string)=>n.startsWith('whatsapp:')?n:`whatsapp:${n}`;const form=new URLSearchParams({To:normalize(to),From:normalize(from),Body:body});const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,{method:'POST',headers:{authorization,'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(12000)});const d:any=await r.json();if(!r.ok)throw new Error(`Twilio WhatsApp failed: ${d.message||r.status}`);return {provider:'twilio-whatsapp',messageId:d.sid};}
}
export function createWhatsAppAdapter():WhatsAppAdapter{return (process.env.WHATSAPP_PROVIDER||'mock').toLowerCase()==='twilio'?new TwilioWhatsAppAdapter():new MockWhatsAppAdapter();}
