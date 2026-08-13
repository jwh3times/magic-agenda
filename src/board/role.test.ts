import { describe, expect, test } from 'vitest'
import {
  asBoardRole,
  BOARD_ROLES,
  capabilitiesFor,
  NO_CAPABILITIES,
  type BoardCapabilities,
  type BoardRole,
} from './role'

const CAPABILITY_KEYS = Object.keys(NO_CAPABILITIES) as (keyof BoardCapabilities)[]

/**
 * The role table, asserted as a table.
 *
 * Written as data rather than as ten `expect(...).toBe(true)` lines because the thing under test
 * IS a table — a transcription error is the realistic failure, and a transcription is best checked
 * against a second transcription that reads like the source document.
 */
const EXPECTED: Record<BoardRole, (keyof BoardCapabilities)[]> = {
  owner: CAPABILITY_KEYS,
  editor: ['viewContent', 'setOwnPreferences', 'editContent', 'assignLabels', 'transferContent'],
  viewer: ['viewContent', 'setOwnPreferences'],
}

describe.each(BOARD_ROLES)('%s', (role) => {
  test('grants exactly the capabilities the domain model resolves', () => {
    const granted = CAPABILITY_KEYS.filter((k) => capabilitiesFor(role)[k])
    expect(granted.sort()).toEqual([...EXPECTED[role]].sort())
  })
})

test('owner is the only role that can manage members, labels, export, or delete', () => {
  // The four Owner-only rows, pinned separately from the table above so that widening any of them
  // fails a test whose name says what was widened.
  for (const key of ['manageMembers', 'manageLabels', 'exportBoard', 'deleteBoard'] as const) {
    expect(capabilitiesFor('owner')[key]).toBe(true)
    expect(capabilitiesFor('editor')[key]).toBe(false)
    expect(capabilitiesFor('viewer')[key]).toBe(false)
  }
})

test('a viewer can read and set their own preferences but change no content', () => {
  // Viewers keep `setOwnPreferences` on purpose: Default View is a Membership Preference, personal
  // to the account, and is the one thing a read-only member still writes.
  expect(capabilitiesFor('viewer').viewContent).toBe(true)
  expect(capabilitiesFor('viewer').setOwnPreferences).toBe(true)
  expect(capabilitiesFor('viewer').editContent).toBe(false)
  expect(capabilitiesFor('viewer').assignLabels).toBe(false)
})

test('no role is missing a capability key', () => {
  // Catches the half-finished addition: a new capability added to the interface and to `owner` but
  // forgotten on `editor`/`viewer` would otherwise read as `undefined` — falsy, so it would fail
  // closed and silently, which is safe but invisible.
  for (const role of BOARD_ROLES) {
    expect(Object.keys(capabilitiesFor(role)).sort()).toEqual([...CAPABILITY_KEYS].sort())
  }
})

describe('capabilitiesFor with no membership', () => {
  test.each([null, undefined])('%s grants nothing', (value) => {
    expect(capabilitiesFor(value)).toEqual(NO_CAPABILITIES)
    expect(CAPABILITY_KEYS.every((k) => !NO_CAPABILITIES[k])).toBe(true)
  })

  test('an unrecognized role grants nothing rather than defaulting to viewer', () => {
    // The dangerous default. A role string this client does not know means the client is older
    // than the schema; treating it as any known role invents an authority level nobody granted.
    expect(capabilitiesFor('admin' as BoardRole)).toEqual(NO_CAPABILITIES)
  })
})

describe('asBoardRole', () => {
  test.each(BOARD_ROLES)('accepts %s', (role) => {
    expect(asBoardRole(role)).toBe(role)
  })

  test.each([['admin'], ['Owner'], [''], [null], [undefined], [1], [{}], [['owner']]])(
    'rejects %o',
    (value) => {
      expect(asBoardRole(value)).toBeNull()
    },
  )
})

test('capability objects are frozen', () => {
  // These are shared singletons — a component mutating one would change what every other component
  // is allowed to do, from anywhere in the tree.
  expect(Object.isFrozen(capabilitiesFor('viewer'))).toBe(true)
  expect(Object.isFrozen(NO_CAPABILITIES)).toBe(true)
})
