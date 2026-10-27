import { Queue, Worker, type Job } from 'bullmq';
import type { Pool } from 'mysql2/promise';
import { createEmailAdapter } from '../adapters/emailAdapter';
import { createSmsAdapter } from '../adapters/smsAdapter';
import { createWhatsAppAdapter } from '../adapters/whatsappAdapter';

type NotificationJob = {
  channel: 'email' | 'sms' | 'whatsapp';
  to: string;
  template: string;
  subject: string;
  message: string;
};

// Parse REDIS_URL manually for BullMQ.
// FIX: rediss:// (Upstash) needs TLS enabled, otherwise the queue hangs forever.
const connection = (() => {
  const u = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null as null
  };
})();

export const notificationQueue = new Queue<NotificationJob>('skymate-notifications', {
  connection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});

export async function enqueueNotification(job: NotificationJob) {
  return notificationQueue.add(job.template, job);
}

export function startNotificationWorker(db: Pool) {
  const worker = new Worker<NotificationJob>(
    'skymate-notifications',
    async (job: Job<NotificationJob>) => {
      const { channel, to, template, subject, message } = job.data;
      let status = 'MOCKED';
      let provider = 'mock';
      const table =
        channel === 'email' ? 'email_logs' : channel === 'sms' ? 'sms_logs' : 'whatsapp_logs';

      try {
        if (channel === 'email') {
          const adapter = createEmailAdapter();
          if (adapter.sendMessage) await adapter.sendMessage(to, subject, message);
          else await adapter.sendOtp(to, message);
          provider = process.env.EMAIL_PROVIDER || 'mock';
          // FIX: resend and smtp both count as real delivery
          status = provider === 'mock' ? 'MOCKED' : 'SENT';
        } else if (channel === 'sms') {
          const result = await createSmsAdapter().send(to, message);
          provider = result.provider;
          status = provider === 'mock' ? 'MOCKED' : 'SENT';
        } else {
          const result = await createWhatsAppAdapter().send(to, message);
          provider = result.provider;
          status = provider === 'mock' ? 'MOCKED' : 'SENT';
        }

        await db.execute(
          `INSERT INTO ${table}(recipient,template,status,provider_reference) VALUES(?,?,?,?)`,
          [to, template, status, `bullmq:${job.id}`]
        );
        await db.execute(
          'INSERT INTO notification_logs(channel,recipient,template,status) VALUES(?,?,?,?)',
          [channel, to, template, status]
        );
        return { status, provider };
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Notification failure';
        await db.execute(
          `INSERT INTO ${table}(recipient,template,status,error_message) VALUES(?,?,?,?)`,
          [to, template, 'FAILED', error.slice(0, 900)]
        );
        await db
          .execute(
            'INSERT INTO notification_logs(channel,recipient,template,status) VALUES(?,?,?,?)',
            [channel, to, template, 'FAILED']
          )
          .catch(() => undefined);
        throw e;
      }
    },
    { connection }
  );

  worker.on('failed', (job, err) =>
    console.error(
      JSON.stringify({ event: 'notification_failed', jobId: job?.id, error: err.message })
    )
  );

  return worker;
}