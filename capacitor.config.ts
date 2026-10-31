import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android app: the game's build (`dist`) packed into a native app, which shows it in
 * Android's WebView. See "Android app" in the README.
 */
const config: CapacitorConfig = {
  appId: 'io.github.fionapreroll.sparkhunt',
  appName: 'Spark Hunt',
  webDir: 'dist',
  android: {
    // The game draws its own dark background; no white flash while the WebView starts.
    backgroundColor: '#0b0d1a',
  },
}

export default config
