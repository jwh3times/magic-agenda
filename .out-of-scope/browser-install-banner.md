# Letting the browser show its own install banner

Magic Agenda stops the browser's own install banner on every route, Landing and Login included. It
calls `preventDefault()` on `beforeinstallprompt` as soon as the event is captured at startup
(`src/install/installPrompt.ts`). Showing the browser's banner to signed-out visitors, or
everywhere, is out of scope.

## Why this is out of scope

A person should see one install suggestion, not two (user story 57 in spec #563). Signed-in people
already get the app's own: the Board's install banner (#568) and Settings → Install the app (#567).
Both use the event the capture holds.

The capture runs before anything knows the route or the session. Letting the banner through only
for signed-out visitors would tie the capture to the session. It would also still show two
suggestions to someone who signs in after the browser's banner has appeared. Never calling it would
put the browser's banner next to the app's own on the Board.

What this costs is signed-out visitors on Landing and Login, who probably get no browser banner.
Spec #563 deliberately leaves installing off the Landing page, and the browser's menu still offers
it.

**Not confirmed on a device.** No Android phone was available, so what Chrome shows with or without
the call comes from its documentation.

## What would reopen it

- A check on a real Android phone that finds signed-out visitors were getting real value from the
  browser's banner.
- A decision that the Landing page should offer installing, which #563 currently leaves out.

## Prior requests

- #590: "Should the install prompt capture stop the browser's own banner on every route?"
