-- ---------------------------------------------------------------------------
-- A pending Invitation ends with its issuer's Ownership
-- ---------------------------------------------------------------------------
-- `accept_invitation` checks the token, the invitee's verified email, expiry and status. It never
-- asks who issued the Invitation, and that was deliberate while every Board had one Owner. With
-- co-Owners it left a way back in: an Owner who is removed, demoted, leaves, or deletes their
-- account keeps every Invitation they issued, redeemable for up to 14 days, including one
-- addressed to a second account of their own. Remaining Owners could revoke it only if they knew
-- to look, and the pending list did not say who had issued what.
--
-- The rule is now: **an Invitation is only as good as its issuer's current Ownership of that
-- Board.** Ending the Ownership revokes the issuer's pending Invitations there, in the same
-- transaction, by trigger rather than in each command, so the four ways an Ownership ends —
-- `remove_member`, `change_member_role`, `leave_board`, and `handle_account_deletion` — and any
-- later one are covered by a single statement. Every one of them already holds the Board row lock,
-- the same lock `accept_invitation` takes, so an acceptance cannot slip between the Ownership
-- ending and the revocation.
--
-- Revoked, not deleted: the row stays as the activity record, like any other revocation, and the
-- retention job removes its email 30 days later. An already expired row is left for the daily job
-- to mark `expired`, which is what it is.

create function public.revoke_invitations_of_ended_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.board_invitations invitation
     set status = 'revoked',
         responded_at = pg_catalog.now()
   where invitation.board_id = old.board_id
     and invitation.invited_by = old.account_id
     and invitation.status = 'pending'
     and invitation.expires_at > pg_catalog.now();
  return new;
end;
$$;

create trigger board_memberships_revoke_invitations
  after update of ended_at, role on public.board_memberships
  for each row
  when (
    old.role = 'owner'
    and old.ended_at is null
    and old.account_id is not null
    and (new.ended_at is not null or new.role <> 'owner')
  )
  execute function public.revoke_invitations_of_ended_owner();

-- Owner only: it runs as a trigger, never as an RPC.
revoke all on function public.revoke_invitations_of_ended_owner()
  from public, anon, authenticated, service_role;

-- Invitations already pending from someone who is no longer an Owner of that Board — removed,
-- demoted, gone, or deleted (`invited_by` NULL) before this rule existed. Same outcome as the
-- trigger, once.
update public.board_invitations invitation
   set status = 'revoked',
       responded_at = pg_catalog.now()
 where invitation.status = 'pending'
   and invitation.expires_at > pg_catalog.now()
   and not exists (
     select 1 from public.board_memberships membership
      where membership.board_id = invitation.board_id
        and membership.account_id = invitation.invited_by
        and membership.role = 'owner'
        and membership.ended_at is null
   );
