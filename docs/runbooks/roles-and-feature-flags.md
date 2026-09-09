# Roles and feature flags

Account administration controls feature rollout. It grants no access to another Account's Boards
or Tasks. Board Membership remains the authorization boundary for Board content.

## Assign or revoke an administrator

Use a trusted SQL connection as the migration owner. Resolve and verify the intended Account's
UUID before running either statement. There is no signup option, profile edit, or client API that
can assign a role; even an administrator cannot assign another administrator through the Data API.

```sql
insert into public.user_roles (user_id, role)
values ('<verified-account-uuid>'::uuid, 'admin');

-- Revoke: the next flag write is checked against the live database row.
delete from public.user_roles where user_id = '<verified-account-uuid>'::uuid;
```

Do not add the role to JWT claims. Deleting an Account cascades to its role. No administrator is
seeded by migrations, and the app does not currently include an administrator management screen.

## Define a rollout flag

An authenticated administrator may insert and delete flag definitions, or update their `enabled`
and `description` fields. Keys are immutable through the Data API. Trusted SQL can also manage
definitions:

```sql
insert into public.feature_flags (key, enabled, description)
values ('example_feature', false, 'Describe the gated behavior');

update public.feature_flags set enabled = true where key = 'example_feature';
```

Every authenticated Account can read every flag and description, so keep confidential information
out of both. Missing flags are disabled; deleting a flag disables its gate on the next refresh.

## Consume flags in React

Under `AuthProvider`, use the hooks directly; no additional provider is required:

```tsx
const { isEnabled, loading, error, reload } = useFlags()
const { isAdmin } = useRole()
```

Import them from `src/access/useFlags` and `src/access/useRole`. Gate a feature with
`isEnabled('example_feature')`; use `isAdmin` only to show administrator controls. A UI gate is
never authorization: enforce every protected read or write independently in database policies.

The hooks read on mount, session change, reconnection, window focus, and every minute. `reload()`
allows an immediate refresh after a flag edit. Requests are ordered so late responses cannot
overwrite a newer result. Account changes clear old values immediately. Offline mode, sign-out,
and read errors close gates; no role or flag data is persisted locally. Each mounted hook owns its
read lifecycle, so put it at the feature boundary rather than inside every item in a list.

## Verify a change

Use two distinct authenticated clients and an anonymous client. The administrator must be able to
manage flags; the ordinary Account must read them but cannot write them or assign itself a role;
the anonymous client must read no rows. Revoke the administrator using SQL and retry a write with
the same signed-in client: it must fail without signing out. `tests/rls/feature_flags.test.ts`
exercises these boundaries against the local stack, including helper isolation from the Data API.

The tables are included in ordinary public-schema backups. A restore should preserve role rows
and flag definitions, while the migration recreates their grants, policies, and private helper.
