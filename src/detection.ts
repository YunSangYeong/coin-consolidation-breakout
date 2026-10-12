import { INTERVAL, type Box, type Candle, type Detection } from './types';
export function closedCandles(candles: Candle[], asOf: number) {
  return candles.filter(c => c.time + INTERVAL <= asOf);
}
/** Seed with 14 true ranges (first uses high-low), then Wilder recursive smoothing. */
export function wilderAtr(candles: Candle[]): number[] {
  let atr = NaN, sum = 0;
  return candles.map((c, i) => {
    const tr = i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i-1].close), Math.abs(c.low - candles[i-1].close));
    if (i < 14) { sum += tr; if (i === 13) atr = sum / 14; }
    else atr = (atr * 13 + tr) / 14;
    return atr;
  });
}
export function detect(candles: Candle[]): Detection {
  const atrs = wilderAtr(candles);
  const signals: Detection['signals'] = [];
  let box: Box | undefined;
  let formedIndex = -1;
  let terminalIndex = -1;
  for (let i = 49; i < candles.length; i++) {
    const c = candles[i];
    if (box) {
      const age = i - formedIndex;
      const mean = candles.slice(i - 50, i).reduce((s, x) => s + x.volume, 0) / 50;
      const range = c.high - c.low;
      const volumeValid = mean > 0 && range > 0 && c.volume >= mean * 2;
      const long = volumeValid && c.close >= box.upper + box.atr * .1 &&
        (c.close - c.low) / range >= .7;
      const short = volumeValid && c.close <= box.lower - box.atr * .1 &&
        (c.high - c.close) / range >= .7;
      // Confirm either direction before lower-bound invalidation or tenth-bar expiry.
      // A box is consumed by its first signal, regardless of direction.
      if (long || short) {
        signals.push({ direction: long ? 'long' : 'short', box, closeTime: c.time + INTERVAL,
          close: c.close, volumeMultiple: c.volume / mean });
        box = undefined; terminalIndex = i;
      } else if (c.close < box.lower || age >= 10) {
        box = undefined; terminalIndex = i;
      }
      continue; // Never form a new box on a terminal candle.
    }
    // A new candidate's entire 50-bar window must be after the prior terminal bar.
    if (i - 49 <= terminalIndex) continue;
    const window = candles.slice(i - 49, i + 1);
    const upper = Math.max(...window.map(x => x.high));
    const lower = Math.min(...window.map(x => x.low));
    const width = upper - lower;
    if (atrs[i] > 0 && width <= atrs[i] * 5 && Math.abs(c.close - window[0].close) <= width * .3) {
      formedIndex = i;
      box = { id: String(c.time + INTERVAL), upper, lower, atr: atrs[i], formedAt: c.time + INTERVAL, start: window[0].time };
    }
  }
  return { signals, ...(box ? { waiting: { ...box, waited: candles.length - 1 - formedIndex } } : {}) };
}
export function validateHistory(raw: Candle[], asOf: number): Candle[] {
  const candles = closedCandles(raw, asOf);
  const expectedEnd = Math.floor(asOf / INTERVAL) * INTERVAL - INTERVAL;
  if (candles.length !== 1000) throw new Error('확정봉 1000개 부족 (신규 상장 또는 데이터 부족)');
  if (candles.at(-1)!.time !== expectedEnd) throw new Error('최신 확정봉 누락');
  if (candles.some((c, i) => i > 0 && c.time - candles[i-1].time !== INTERVAL)) throw new Error('캔들 누락 또는 중복');
  return candles;
}
