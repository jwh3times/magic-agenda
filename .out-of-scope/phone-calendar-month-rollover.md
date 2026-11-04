# The phone Calendar following the clock across a month's end

If the phone Calendar is left open across midnight at the end of a month and nobody has tapped a
day, the panel moves from the old month's last day back to its 1st. Magic Agenda leaves this as it
is.

## Why this is out of scope

The panel's default selection is one rule, from spec #563: today if the visible month contains it,
otherwise the 1st (`defaultSelectedDay`). The visible month doesn't follow the clock, so at the
rollover today leaves the visible month and the rule picks the 1st. That is the rule working as
written, in a case the spec didn't consider.

Both ways of changing it cost more than the case is worth:

- **Moving the visible month with the clock** changes the month someone is looking at without any
  action from them. Done in `Board`, it also reaches beyond the phone layout.
- **Holding the last selected day until the person acts** adds a second rule beside the first. It
  stops the panel following today in the middle of a month too, unless it is limited to the moment
  today leaves the visible month.

Meanwhile the case needs the app left open across a month's end with no day tapped, and pressing
Today fixes it in one tap.

## What would reopen it

A report that this has actually confused someone.

## Prior requests

- #581: "Phone Calendar: should the panel jump back to the 1st when the date rolls into a new
  month?"
