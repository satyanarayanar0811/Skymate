import { getTwilioRequestAuth } from './twilioAuth';

export interface SmsAdapter { send(to:string,body:string):Promise<{provider:string;messageId?:string}> }
class MockSmsAdapter implements SmsAdapter { async send(to:string,body:string){if(process.env.NODE_ENV==='production')throw new Error('Mock SMS disabled in production');console.info(JSON.stringify({event:'mock_sms',to,body:body.slice(0,300)}));return {provider:'mock'};} }
class TwilioSmsAdapter implements SmsAdapter {
 async send(to:string,body:string){const from=process.env.TWILIO_SMS_FROM;if(!from||from==='mock')throw new Error('Set TWILIO_SMS_FROM to an SMS-enabled Twilio phone number.');const {accountSid,authorization}=getTwilioRequestAuth();const form=new URLSearchParams({To:to,From:from,Body:body});const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,{method:'POST',headers:{authorization,'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(12000)});const d:any=await r.json();if(!r.ok)throw new Error(`Twilio SMS failed: ${d.message||r.status}`);return {provider:'twilio',messageId:d.sid};}
}
export function createSmsAdapter():SmsAdapter{return (process.env.SMS_PROVIDER||'mock').toLowerCase()==='twilio'?new TwilioSmsAdapter():new MockSmsAdapter();}
