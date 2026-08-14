import BuddyLogo from './BuddyLogo'
import SplashIllustration from './SplashIllustration'
import './SplashScreen.css'

/*
 * SplashScreen
 * ------------
 * The first thing a child sees when Buddy Talk opens.
 *
 * It contains only four things, and nothing else:
 *   1. the Buddy Talk logo
 *   2. the name "Buddy Talk"
 *   3. the tagline
 *   4. the illustration
 *
 * There is nothing to tap. It appears, holds for a moment, then App.jsx
 * fades it out and moves on by itself.
 *
 * Props:
 *   isLeaving - true once the screen has started fading out. App.jsx owns
 *               the timing; this component just reflects it with a class.
 */
function SplashScreen({ isLeaving = false }) {
  return (
    <div className={`splash ${isLeaving ? 'splash--leaving' : ''}`}>
      {/* The soft warm glow sits behind the logo and gently draws the eye
          to the one thing on screen that matters most. */}
      <div className="splash__glow" aria-hidden="true" />

      <div className="splash__stage">
        <BuddyLogo className="splash__logo" title="Buddy Talk" />

        <h1 className="splash__name">Buddy Talk</h1>

        <p className="splash__tagline">Let&rsquo;s talk together!</p>
      </div>

      <SplashIllustration className="splash__illustration" />
    </div>
  )
}

export default SplashScreen
