import { useState, useEffect } from 'react'
import SplashScreen from './components/SplashScreen'
import AccountScreen from './components/AccountScreen/AccountScreen'
import './App.css'

/*
 * How long the splash stays fully visible, and how long it takes to fade.
 * They live here as named constants so the timing is easy to find and tweak.
 */
const SPLASH_VISIBLE_MS = 2400
const SPLASH_FADE_MS = 400

function App() {
  /*
   * `phase` is a piece of STATE: a value React remembers between renders.
   * When we change it with setPhase(), React re-runs this function and
   * updates the screen to match. It moves in one direction only:
   *
   *   'splash'  -> the splash screen is showing
   *   'leaving' -> still showing, but fading out
   *   'done'    -> splash finished, next screen takes over
   */
  const [phase, setPhase] = useState('splash')

  /*
   * useEffect runs code AFTER React has drawn the screen. It is the right
   * place for things that are not rendering -- here, two timers.
   *
   * The empty array [] at the end means "run this once, when the app first
   * appears", not on every render.
   *
   * The function we return is the CLEANUP. React calls it if the component
   * goes away before the timers fire, which cancels them. Without it a timer
   * could try to update a component that no longer exists. It also keeps
   * things correct in development, where React's StrictMode deliberately
   * mounts everything twice to help you catch exactly this kind of bug.
   */
  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase('leaving'), SPLASH_VISIBLE_MS)
    const doneTimer = setTimeout(() => setPhase('done'), SPLASH_VISIBLE_MS + SPLASH_FADE_MS)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  if (phase !== 'done') {
    return <SplashScreen isLeaving={phase === 'leaving'} />
  }

  /*
   * Once the splash has finished, the Account screen takes over. It handles
   * its own Sign up / Sign in switching internally, so App does not need to
   * know which of the two views is showing.
   */
  return <AccountScreen />
}

export default App
