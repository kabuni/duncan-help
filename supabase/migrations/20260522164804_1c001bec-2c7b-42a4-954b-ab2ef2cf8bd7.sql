-- Reconcile Samaresh RSVP so cron reprocesses it and captures Swayam as 2nd attendee
DELETE FROM public.event_rsvp_messages WHERE gmail_message_id = '19e4ea2c99ac4db2';
UPDATE public.event_rsvps
   SET notes = NULL,
       reply_sent_at = NULL,
       reply_message_id = NULL,
       reply_error = NULL
 WHERE id = '0e5b6d04-26e2-4e46-944d-978d551b01b9';