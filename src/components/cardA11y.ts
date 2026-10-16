/**
 * What names a card, and what describes it, for the `role="button"` wrapper around it (#337).
 * Named from its content, the card read Pin and Complete into its own name, where "Complete"
 * sounds like the Task's status; those are separate controls that screen readers reach on their
 * own. So the title names the card and the rest of what it shows describes it. An id whose element
 * this card does not render is skipped, so the lists can name every part a card can have.
 */
export const cardNameIds = (a11yId: string) => `${a11yId}-title`
export const cardDetailIds = (a11yId: string) =>
  ['stamp', 'desc', 'label', 'time', 'day', 'assignee', 'progress']
    .map((part) => `${a11yId}-${part}`)
    .join(' ')
