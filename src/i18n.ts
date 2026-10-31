/** Every text players see, in English and German. The browser's language picks one. */
const en = {
  title: 'Spark Hunt',
  tagline: 'A game for phones side by side: no internet, no server, no app.',
  yourName: 'Your name',
  defaultName: 'Player {n}',
  host: 'Host a game',
  join: 'Join a game',
  hotspotTip:
    'All phones must be on the same Wi-Fi. Out and about, one phone opens a hotspot and the others join it; no mobile data is used.',
  offline: 'Open this page once while online: after that it also starts without internet.',
  back: 'Back',
  leaveHost: 'End the game for everyone?',
  tryAgain: 'Try again',
  cancel: 'Cancel',
  addPlayer: 'Add player',
  start: 'Start round',
  again: 'Play again',
  you: 'you',
  host_: 'host',
  pingMs: '{ms} ms',
  pairStep1: '1. The new player taps “Join a game” and scans this code.',
  pairStep2: '2. Then turn your phone round and scan the code on the other phone.',
  connecting: 'Connecting…',
  connected: '{name} joined.',
  connectFailed: 'The connection failed. Are both phones on the same Wi-Fi or hotspot?',
  joinStep1: 'Scan the code on the host’s screen.',
  joinStep2: 'Show this code to the host and keep the screen on.',
  waitHost: 'Waiting for the host to start…',
  noCamera: 'The camera is not available. Use the text codes below instead.',
  textCodes: 'No camera? Use text codes',
  copy: 'Copy',
  copied: 'Copied',
  pasteHere: 'Paste the other phone’s code here',
  useCode: 'Use code',
  badCode: 'That is not a code from this game, or not the one expected here.',
  lost: 'The connection to the host was lost.',
  playerLeft: '{name} left.',
  full: 'This game is full.',
  timeLeft: '{s} s',
  steer: 'Touch where your dot should go and catch the sparks. Golden ones count three.',
  winner: '{names} wins!',
  tie: 'Tie: {names}',
  noWinner: 'Nobody caught a spark.',
  lobby: 'Warm up while more players join.',
}

const de: Record<TextKey, string> = {
  title: 'Funkenjagd',
  tagline: 'Ein Spiel für Handys nebeneinander: ohne Internet, ohne Server, ohne App.',
  yourName: 'Dein Name',
  defaultName: 'Spieler {n}',
  host: 'Spiel eröffnen',
  join: 'Mitspielen',
  hotspotTip:
    'Alle Handys müssen im selben WLAN sein. Unterwegs öffnet ein Handy einen Hotspot und die anderen verbinden sich damit; mobile Daten werden nicht verbraucht.',
  offline: 'Öffne die Seite einmal mit Internet: Danach startet sie auch ohne Verbindung.',
  back: 'Zurück',
  leaveHost: 'Das Spiel für alle beenden?',
  tryAgain: 'Nochmal versuchen',
  cancel: 'Abbrechen',
  addPlayer: 'Mitspieler hinzufügen',
  start: 'Runde starten',
  again: 'Noch eine Runde',
  you: 'du',
  host_: 'Host',
  pingMs: '{ms} ms',
  pairStep1: '1. Wer neu dazukommt, tippt auf „Mitspielen“ und scannt diesen Code.',
  pairStep2: '2. Dann drehst du dein Handy um und scannst den Code auf dem anderen Handy.',
  connecting: 'Verbinde…',
  connected: '{name} spielt mit.',
  connectFailed:
    'Die Verbindung ist fehlgeschlagen. Sind beide Handys im selben WLAN oder Hotspot?',
  joinStep1: 'Scanne den Code auf dem Bildschirm des Hosts.',
  joinStep2: 'Zeig diesen Code dem Host und lass den Bildschirm an.',
  waitHost: 'Warte, bis der Host die Runde startet…',
  noCamera: 'Die Kamera ist nicht verfügbar. Nimm stattdessen die Text-Codes unten.',
  textCodes: 'Keine Kamera? Text-Codes verwenden',
  copy: 'Kopieren',
  copied: 'Kopiert',
  pasteHere: 'Code des anderen Handys hier einfügen',
  useCode: 'Code verwenden',
  badCode: 'Das ist kein Code dieses Spiels, oder nicht der, der hier erwartet wird.',
  lost: 'Die Verbindung zum Host ist abgebrochen.',
  playerLeft: '{name} ist gegangen.',
  full: 'Dieses Spiel ist voll.',
  timeLeft: '{s} s',
  steer: 'Tippe dorthin, wo dein Punkt hin soll, und fang die Funken. Goldene zählen dreifach.',
  winner: '{names} gewinnt!',
  tie: 'Unentschieden: {names}',
  noWinner: 'Niemand hat einen Funken gefangen.',
  lobby: 'Wärm dich auf, während weitere Spieler dazukommen.',
}

export type TextKey = keyof typeof en
const TEXTS = { en, de }
export type Language = keyof typeof TEXTS

export const language: Language =
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('de')
    ? 'de'
    : 'en'

/** The text for a key in the player's language, with `{name}` placeholders filled in. */
export function t(key: TextKey, params: Record<string, string | number> = {}): string {
  return TEXTS[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}
