-- Settings -> Notifications lists every device an Account has subscribed, so a subscription made
-- on a device the owner no longer has (a lost laptop, a browser they signed out of somewhere else)
-- can be removed from another one. Before this, the only way to remove one was from the browser
-- that held it.
--
-- The endpoint is a credential, never shown, and all it says is which push service a browser
-- uses, so the browser that subscribes records a short label of its own ("Firefox on Linux"). It is
-- a display hint read only by the row's owner, under the existing owner-only policies and
-- table-level grants; nothing authorizes on it. Nullable, because rows saved before this have
-- none, and the list then names the push service instead.

alter table public.push_subscriptions
  add column device_label text
    constraint push_subscriptions_device_label_length
    check (device_label is null or char_length(device_label) between 1 and 64);
