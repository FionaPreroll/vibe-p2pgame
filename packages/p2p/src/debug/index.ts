/**
 * What helps find out why a game misbehaves on someone's phone: a log that masks what must not
 * leave the phone, how well every connection keeps up second by second, a graph of it, and a
 * debug report's lines about the network. Games bring their own texts and screens.
 */
export { detailsLines, testLine, testLines } from './details.ts'
export { drawNetGraph, type NetGraphOptions, pingQuality, worstLatest } from './graph.ts'
export { DebugLog, describeError, redact } from './log.ts'
export {
  NetLog,
  type NetReading,
  type NetSample,
  networkLines,
  type PeerSummary,
  peerLabel,
  REPORT_SAMPLES,
  SAMPLE_MS,
  STALL_MS,
  samplesCsv,
  summaryLines,
} from './netlog.ts'
export {
  type ConnectionRow,
  type ConnectionView,
  type ConnectionViewOptions,
  type ConnectionViewTexts,
  connectionView,
  type ShownConnection,
} from './view.ts'
