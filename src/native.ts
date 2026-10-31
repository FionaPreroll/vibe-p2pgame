import { Capacitor } from '@capacitor/core'

/**
 * What the Android app has beyond the browser. Everything here also works on the web, where it
 * does nothing: the game stays one codebase. The plugin is loaded only in the app.
 */

/** True inside the Android app, false in a browser. */
export function isApp(): boolean {
  return Capacitor.isNativePlatform()
}

type ScannerPlugin = typeof import('@capacitor-mlkit/barcode-scanning')
let plugin: Promise<ScannerPlugin> | undefined

function scannerPlugin(): Promise<ScannerPlugin> {
  plugin ??= import('@capacitor-mlkit/barcode-scanning')
  return plugin
}

/**
 * Whether Google's ready-made scanner screen can open. It comes with Google Play services as a
 * module that is downloaded once, over the internet; when it is missing, this starts the
 * download, so that the app asks at every start and has it later on a hotspot without internet.
 */
export async function nativeScannerReady(): Promise<boolean> {
  if (!isApp()) return false
  try {
    const { BarcodeScanner } = await scannerPlugin()
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => {})
    return available
  } catch {
    return false
  }
}

/**
 * Opens Google's scanner screen, which focuses and zooms by itself, for one QR code. The texts
 * read, or null if the player went back or the scanner failed.
 */
export async function nativeScan(): Promise<string[] | null> {
  try {
    const { BarcodeFormat, BarcodeScanner } = await scannerPlugin()
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode],
      autoZoom: true,
    })
    return barcodes
      .map((barcode) => barcode.rawValue)
      .filter((text): text is string => typeof text === 'string' && text !== '')
  } catch {
    return null
  }
}
