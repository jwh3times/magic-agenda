-- Activate the five-minute Reminder sender (#267).
--
-- The bearer credential and function URL live in Supabase Vault. The scheduled command contains
-- only their stable Vault names, so neither migration history nor cron.job exposes a secret.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'send-task-reminders';

select cron.schedule(
  'send-task-reminders',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'reminder_function_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'reminder_cron_secret'
        )
      ),
      body := jsonb_build_object('scheduled_at', pg_catalog.now())
    );
  $$
);
