#!/usr/bin/env bash
# Preview what `supabase config push` would change for the required `Config` check, with the
# read-only `supabase config diff --exit-code` (#640), and classify the result (#429).
#
#   no difference               exit 0  (diff exited 0)
#   pending differences listed  exit 0  (diff exited 2; the diff itself is the preview)
#   failed                      retried, then non-zero
#   timed out                   retried, then non-zero
#
# Why `config diff`: Supabase CLI v3 removed what the old preview relied on. `config push` now asks
# one combined question, ignores answers piped on stdin, and fails unattended with
# `HostedMutationConsentRequiredError`, so declining prompts with `yes n` no longer previews
# anything. `config diff` never writes local or remote configuration, and `--exit-code` makes the
# outcome an exit status instead of output to count. Its stdin is closed all the same, so nothing
# could ever be answered on its behalf.
#
# The output goes to the job log and summary, which are public. The secret fields `config.toml`
# fills from `env()` (SMTP password, OAuth client secret, captcha secret) are marked secret in the
# CLI's config mapping and rendered masked (present/absent, or a hash), never as values — and
# GitHub masks repository secrets in logs besides. Never add a flag that unmasks them.
#
# Why bounded: #429 measured the CLI hanging indefinitely after `supabase link` succeeded, which let
# this required check hold a runner for GitHub's six-hour default while branch protection blocked
# the merge. Each attempt runs under `timeout --kill-after`, and the job carries its own
# `timeout-minutes` as the outer bound.
#
# Why retried: Supabase reported CLI/CI rate limiting just before that hang. A retry is safe because
# every attempt is the same read-only diff.
#
# Tunables (CI uses the defaults; tests shrink them). CONFIG_PREVIEW_COMMAND replaces the diff for
# tests only; the workflow never sets it.
set -u

attempt_timeout="${CONFIG_PREVIEW_ATTEMPT_TIMEOUT:-180}"
attempts="${CONFIG_PREVIEW_ATTEMPTS:-3}"
backoff="${CONFIG_PREVIEW_BACKOFF:-20}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
command="${CONFIG_PREVIEW_COMMAND:-supabase config diff --exit-code --agent no --output-format text}"

last_reason=""
for attempt in $(seq 1 "$attempts"); do
  out=$(timeout --kill-after=10 "$attempt_timeout" bash -c "$command" < /dev/null 2>&1)
  code=$?

  {
    echo "## Pending \`supabase config push\` changes (\`config diff\`) — attempt $attempt of $attempts"
    echo '```'
    echo "$out"
    echo '```'
  } >> "$summary"
  echo "$out"

  case "$code" in
    0)
      echo "No pending changes — remote already matches the file."
      exit 0
      ;;
    2)
      echo "Pending changes listed above — config diff is read-only, so nothing was applied."
      exit 0
      ;;
    # 124: timeout's own signal. 137: it had to escalate to SIGKILL after --kill-after.
    124 | 137) last_reason="timed out after ${attempt_timeout}s" ;;
    *) last_reason="failed (exit $code)" ;;
  esac

  echo "Attempt $attempt of $attempts: config diff $last_reason."
  if [ "$attempt" -lt "$attempts" ]; then
    wait_for=$((backoff * attempt))
    echo "Retrying the same read-only diff in ${wait_for}s."
    sleep "$wait_for"
  fi
done

echo "Config preview failed: config diff $last_reason on every attempt. The check stays red."
exit 1
