import { createEmailAdapter } from './emailAdapter';
export interface NotificationAdapter { send(channel:'email'|'sms'|'whatsapp',to:string,subject:string,body:string):Promise<{provider:string;status:'SENT'|'MOCKED'}> }
class MockNotificationAdapter implements NotificationAdapter { async send(_channel:'email'|'sms'|'whatsapp',_to:string,_subject:string,_body:string){return {provider:'mock',status:'MOCKED' as const};} }
class SmtpNotificationAdapter implements NotificationAdapter { async send(channel:'email'|'sms'|'whatsapp',to:string,subject:string,body:string){if(channel!=='email')return {provider:'mock',status:'MOCKED' as const}; const email=createEmailAdapter(); await email.sendOtp(to,body); return {provider:'smtp',status:'SENT' as const};} }
export function getNotificationAdapter():NotificationAdapter { return process.env.EMAIL_PROVIDER==='smtp'?new SmtpNotificationAdapter():new MockNotificationAdapter(); }
