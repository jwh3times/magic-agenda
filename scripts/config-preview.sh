#!/usr/bin/env bash
# Preview `supabase config push` for the required `Config` check — declining every prompt, so it
# never applies anything — and classify the result (#429).
#
#   no pending changes          exit 0  (the command succeeded without asking anything)
#   pending changes, declined   exit 0  (it asked; `yes n` declined every prompt)
#   failed before any prompt    retried, then non-zero
#   timed out                   retried, then non-zero — even if some prompts were already
#                               declined, because a hung preview did not reach every service
#
# Why bounded: #429 measured `supabase config push` hanging indefinitely after `supabase link`
# succeeded, which let this required check hold a runner for GitHub's six-hour default while
# branch protection blocked the merge. Each attempt now runs under `timeout --kill-after`, and the
# job carries its own `timeout-minutes` as the outer bound.
#
# Why retried: Supabase reported CLI/CI rate limiting just before that hang. A retry is safe only
# because every attempt is the same non-applying preview: `yes n` on stdin, `SUPABASE_YES=false`,
# and text output, since machine-readable output skips prompts and accepts their defaults.
#
# Never enable `pipefail` here: `yes` dies of SIGPIPE when the push exits, and pipefail would report
# 141 instead of the push's own exit code, corrupting the no-op classification.
#
# Tunables (CI uses the defaults; tests shrink them). CONFIG_PREVIEW_COMMAND replaces the push for
# tests only; the workflow never sets it.
set -u

attempt_timeout="${CONFIG_PREVIEW_ATTEMPT_TIMEOUT:-180}"
attempts="${CONFIG_PREVIEW_ATTEMPTS:-3}"
backoff="${CONFIG_PREVIEW_BACKOFF:-20}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
command="${CONFIG_PREVIEW_COMMAND:-SUPABASE_YES=false supabase config push --agent no --output-format text}"

last_reason=""
for attempt in $(seq 1 "$attempts"); do
  out=$(yes n | timeout --kill-after=10 "$attempt_timeout" bash -c "$command" 2>&1)
  code=$?

  {
    echo "## Pending \`supabase config push\` changes — attempt $attempt of $attempts (each declined prompt = one pending service)"
    echo '```'
    echo "$out"
    echo '```'
  } >> "$summary"
  echo "$out"

  # 124: timeout's own signal. 137: it had to escalate to SIGKILL after --kill-after.
  if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
    last_reason="timed out after ${attempt_timeout}s"
  else
    prompts=$(echo "$out" | grep -ciE 'do you want|\[y/n\]' || true)
    if [ "$code" -eq 0 ] && [ "$prompts" -eq 0 ]; then
      echo "No pending changes — remote already matches the file."
      exit 0
    fi
    if [ "$prompts" -gt 0 ]; then
      echo "Preview complete: $prompts pending change prompt(s), all declined — nothing applied."
      exit 0
    fi
    last_reason="failed before reaching any confirmation prompt (exit $code)"
  fi

  echo "Attempt $attempt of $attempts: config push $last_reason."
  if [ "$attempt" -lt "$attempts" ]; then
    wait_for=$((backoff * attempt))
    echo "Retrying the same non-applying preview in ${wait_for}s."
    sleep "$wait_for"
  fi
done

echo "Config preview failed: config push $last_reason on every attempt. The check stays red."
exit 1
