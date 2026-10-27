import nodemailer from 'nodemailer';

export interface EmailAdapter {
  sendOtp(recipient: string, otp: string): Promise<void>;
  sendMessage(recipient: string, subject: string, text: string): Promise<void>;
}

export class MockEmailAdapter implements EmailAdapter {
  async sendOtp(recipient: string, otp: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') throw new Error('Mock email adapter is disabled in production.');
    console.info(`[SkyMate mock email] recipient=${recipient} otp=${otp} expires_in_seconds=300`);
  }
  async sendMessage(recipient:string, subject:string, text:string):Promise<void>{
    if(process.env.NODE_ENV==='production') throw new Error('Mock email adapter is disabled in production.');
    console.info(`[SkyMate mock notification] recipient=${recipient} subject=${subject} body=${text.slice(0,300)}`);
  }
}

export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transport;
  constructor() {
    const host = process.env.SMTP_HOST;
    if (!host) throw new Error('SMTP_HOST is required when EMAIL_PROVIDER=smtp.');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 1025),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      ...(user && pass ? { auth: { user, pass } } : {})
    });
  }
  async sendMessage(recipient:string, subject:string, text:string):Promise<void>{
    await this.transport.sendMail({from:process.env.SMTP_FROM||'skymate@localhost.test',to:recipient,subject,text});
  }
  async sendOtp(recipient: string, otp: string): Promise<void> {
    await this.transport.sendMail({
      from: process.env.SMTP_FROM || 'skymate@localhost.test',
      to: recipient,
      subject: 'Your SkyMate sign-in code',
      text: `Your SkyMate email verification code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif"><h2>SkyMate email verification</h2><p>Your one-time verification code is:</p><div style="font-size:30px;font-weight:bold;letter-spacing:8px">${otp}</div><p>This code expires in 5 minutes. Never share it with anyone.</p></div>`
    });
  }
}

export function createEmailAdapter(): EmailAdapter {
  const provider = (process.env.EMAIL_PROVIDER || (process.env.SMTP_HOST ? 'smtp' : 'mock')).toLowerCase();
  if (provider === 'smtp') return new SmtpEmailAdapter();
  if (provider === 'mock') return new MockEmailAdapter();
  throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);
}
