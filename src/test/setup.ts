import '@testing-library/jest-dom'
import { afterEach } from 'vitest'

// Isolate tests from persisted browser state (board view, auth recovery flag),
// so a view switch in one test can't change another test's initial view.
afterEach(() => {
  sessionStorage.clear()
})
