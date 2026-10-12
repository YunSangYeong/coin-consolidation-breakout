export const INTERVAL = 15 * 60_000;
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; turnover: number }
export interface Box { id: string; upper: number; lower: number; atr: number; formedAt: number; start: number }
export interface Breakout { box: Box; closeTime: number; close: number; volumeMultiple: number }
export interface Detection { signals: Breakout[]; waiting?: Box & { waited: number } }
export interface Entry extends Detection { symbol: string; turnover: number }
export interface Failure { symbol: string; reason: string }
export interface Progress { stage: string; done: number; total: number; success: number; failed: number }
export interface ScanResult { entries: Entry[]; failures: Failure[]; universe: number; eligible: number; marketTime: number; finishedAt: number }
