import { useEffect } from 'react'

const DEFAULT_TITLE = 'Magic Agenda'

/**
 * Set the document title (and optionally the meta description) for a route, restoring the
 * previous values on unmount.
 *
 * Deliberately not a helmet-style library: this is a small SPA whose only real SEO surface is the
 * signed-out landing page. `index.html` keeps the sitewide og/twitter tags as the default; this
 * only sharpens the two values a crawler or a browser tab actually reads per route.
 */
export function useDocumentTitle(title: string, description?: string) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    let meta: HTMLMetaElement | null = null
    let previousDescription: string | null = null
    if (description) {
      meta = document.querySelector('meta[name="description"]')
      if (meta) {
        previousDescription = meta.getAttribute('content')
        meta.setAttribute('content', description)
      }
    }

    return () => {
      document.title = previousTitle || DEFAULT_TITLE
      if (meta && previousDescription !== null) meta.setAttribute('content', previousDescription)
    }
  }, [title, description])
}
