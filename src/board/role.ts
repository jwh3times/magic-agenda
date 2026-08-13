/**
 * Board roles and what each one may do.
 *
 * **This is an affordance layer, not an authorization boundary.** RLS is the only thing standing
 * between one account's rows and another's; everything here decides whether to render a button.
 * A capability returning `true` never grants anything — the server rechecks, and a capability
 * returning `false` while the server allows the action is a UI bug, not a hole. Treating this
 * module as security is the one way to misuse it.
 *
 * It exists ahead of its callers on purpose. The alternative is components branching on role
 * strings at their use sites — `role === 'owner' || role === 'editor'` scattered across a tree —
 * which is how a permission model drifts out of sync with the one table that defines it.
 * Components ask capabilities; nothing outside this module compares a role string.
 */

/** The three roles a Board Membership can carry. Mirrors the `role` check constraint. */
export type BoardRole = 'owner' | 'editor' | 'viewer'

export const BOARD_ROLES: readonly BoardRole[] = ['owner', 'editor', 'viewer'] as const

/**
 * What a member may do inside one Board.
 *
 * One flag per row of the domain brief's role table, in its order. Deliberately flat booleans
 * rather than a role hierarchy: the table is not strictly nested in the general case (a future
 * role need not be a superset of a lesser one), and a hierarchy would encode an assumption the
 * domain model does not make.
 */
export interface BoardCapabilities {
  /** View, search, and filter Board content. */
  viewContent: boolean
  /** Change own Account Preferences and this Membership's Default View. */
  setOwnPreferences: boolean
  /** Create, edit, delete, and reorder Tasks and Recurring Series. */
  editContent: boolean
  /** Apply an existing Label to a Task. */
  assignLabels: boolean
  /** Import, copy, or transfer content into or out of this Board. */
  transferContent: boolean
  /** Create, rename, recolor, reorder, or delete Label definitions. */
  manageLabels: boolean
  /** Rename or otherwise configure the Board. */
  configureBoard: boolean
  /** Export the complete Board. */
  exportBoard: boolean
  /** Invite or remove members and change roles. */
  manageMembers: boolean
  /** Permanently delete the Board. */
  deleteBoard: boolean
}

/**
 * The role table, transcribed from the resolved domain model.
 *
 * Two entries are worth knowing are contested rather than obvious:
 *
 * - `manageLabels` is Owner-only while `assignLabels` is Editor+, because changing or deleting a
 *   Label definition reorganizes shared content for every member, whereas assigning one uses the
 *   vocabulary that already exists.
 * - `exportBoard` is Owner-only while `transferContent` is Editor+, which does **not** cohere: an
 *   Editor can copy content into a Board they own and export it from there. The domain brief
 *   concedes export is not a confidentiality boundary and rests the restriction on auditability —
 *   but copy is auditable too. This is a recorded open question, not a settled rule; it is
 *   transcribed as resolved today rather than silently corrected here.
 */
const CAPABILITIES: Readonly<Record<BoardRole, Readonly<BoardCapabilities>>> = Object.freeze({
  owner: Object.freeze({
    viewContent: true,
    setOwnPreferences: true,
    editContent: true,
    assignLabels: true,
    transferContent: true,
    manageLabels: true,
    configureBoard: true,
    exportBoard: true,
    manageMembers: true,
    deleteBoard: true,
  }),
  editor: Object.freeze({
    viewContent: true,
    setOwnPreferences: true,
    editContent: true,
    assignLabels: true,
    transferContent: true,
    manageLabels: false,
    configureBoard: false,
    exportBoard: false,
    manageMembers: false,
    deleteBoard: false,
  }),
  viewer: Object.freeze({
    viewContent: true,
    setOwnPreferences: true,
    editContent: false,
    assignLabels: false,
    transferContent: false,
    manageLabels: false,
    configureBoard: false,
    exportBoard: false,
    manageMembers: false,
    deleteBoard: false,
  }),
})

/**
 * What someone with no current Membership may do: nothing.
 *
 * A separate value rather than a fourth role, because "not a member" is the absence of a
 * Membership, not a kind of one. It is what an ended Membership, a deleted Board, and a Board the
 * caller never joined all reduce to — the UI cannot tell those apart and must not try, since the
 * server deliberately does not distinguish them either.
 */
export const NO_CAPABILITIES: Readonly<BoardCapabilities> = Object.freeze({
  viewContent: false,
  setOwnPreferences: false,
  editContent: false,
  assignLabels: false,
  transferContent: false,
  manageLabels: false,
  configureBoard: false,
  exportBoard: false,
  manageMembers: false,
  deleteBoard: false,
})

/**
 * The capabilities of a current Membership in `role`, or none at all for `null`.
 *
 * `null` is the normal case, not an error: it covers signed-out, still-loading, ended Membership,
 * and non-member alike. Callers that need to distinguish those use the Board Session state, not
 * this function.
 */
export function capabilitiesFor(role: BoardRole | null | undefined): Readonly<BoardCapabilities> {
  if (!role) return NO_CAPABILITIES
  return CAPABILITIES[role] ?? NO_CAPABILITIES
}

/**
 * Narrows an arbitrary string — a database `role` column, an RPC result — to a `BoardRole`.
 *
 * Returns `null` rather than throwing or defaulting to `viewer`. Defaulting would be the more
 * dangerous of the two: an unrecognized role is a client older than the schema, and silently
 * treating it as a known role invents an authority level nobody granted.
 */
export function asBoardRole(value: unknown): BoardRole | null {
  return typeof value === 'string' && (BOARD_ROLES as readonly string[]).includes(value)
    ? (value as BoardRole)
    : null
}
