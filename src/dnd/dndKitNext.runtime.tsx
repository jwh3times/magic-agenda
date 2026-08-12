import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DndKitNextRuntimePrototype } from './dndKitNext.prototype'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DndKitNextRuntimePrototype />
  </StrictMode>,
)
