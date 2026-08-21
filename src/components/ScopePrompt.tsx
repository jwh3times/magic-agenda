import type { RecurScope } from '../data/series'
import type { EditorChrome } from './editorChrome'

export interface ScopePromptProps {
  /** Which question to ask. Changes only the heading and the destructive-button styling. */
  mode: 'save' | 'delete'
  /**
   * True when choosing **This and all future** would end the Recurring Series rather than edit it,
   * i.e. the draft cleared the Repeat control. Only then does the body copy say that later
   * Occurrences are removed.
   *
   * The caller must compute this with `removesRule`, not with its own reading of the draft: the
   * promise made here is only worth making while it matches the plan `resolveSave` routes to
   * (#229). It stays `false` in `delete` mode, where the heading already says "Delete".
   */
  endsSeries?: boolean
  chrome: EditorChrome
  onChoose: (scope: RecurScope) => void
  onCancel: () => void
}

/**
 * "This occurrence, or this and all future?" — the second overlay the task editor can show.
 *
 * It used to be a sibling fragment inside `TaskEditor`, sharing five palette values and the `btn`
 * builder by closure. Rendering it was gated on `scopePrompt && !readOnly`, which **hid** an open
 * prompt when `readOnly` flipped without clearing it, so flipping back re-opened it — a case
 * `TaskEditor.test.tsx` calls a "narrow race". The owner of that state now clears it instead of
 * hiding it, and this component simply renders when it is asked to.
 */
export function ScopePrompt({ mode, endsSeries, chrome, onChoose, onCancel }: ScopePromptProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,4,.5)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9100,
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: 'min(360px, 100%)',
          background: chrome.panelBg,
          color: chrome.fg,
          border: `1px solid ${chrome.border}`,
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 40px 100px rgba(0,0,0,.5)',
          fontFamily: chrome.ui,
          animation: 'modalIn .18s cubic-bezier(.2,.8,.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
          {mode === 'save' ? 'Save repeating task' : 'Delete repeating task'}
        </div>
        <div style={{ fontSize: 13, color: chrome.sub, marginBottom: 16, lineHeight: 1.45 }}>
          {endsSeries
            ? 'This task repeats. Applying to this and all future occurrences will stop it repeating, and later occurrences will be removed.'
            : 'This task repeats. Apply to this occurrence only, or this and all future occurrences?'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={() => onChoose('this')}
            style={chrome.btn(chrome.fieldBg, chrome.fg)}
          >
            This occurrence
          </button>
          <button
            type="button"
            onClick={() => onChoose('future')}
            style={
              mode === 'save'
                ? chrome.btn(chrome.accent, chrome.accentFg)
                : chrome.btn('transparent', '#e0524a', { border: `1px solid ${chrome.border}` })
            }
          >
            This and all future
          </button>
          <button type="button" onClick={onCancel} style={chrome.btn(chrome.fieldBg, chrome.sub)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
