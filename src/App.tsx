import { ThemeProvider } from './theme/ThemeProvider'
import { Board } from './components/Board'

export default function App() {
  return (
    <ThemeProvider>
      <Board />
    </ThemeProvider>
  )
}
