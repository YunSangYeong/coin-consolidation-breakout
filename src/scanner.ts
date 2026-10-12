import { BybitClient, errorMessage } from './api';
import { detect, validateHistory } from './detection';
import type { Entry, Failure, Progress, ScanResult } from './types';
export async function scanMarket(signal: AbortSignal, progress: (p: Progress) => void,
  client: Pick<BybitClient, 'serverTime' | 'instruments' | 'tickers' | 'candles'> = new BybitClient(signal)): Promise<ScanResult> {
  const report = (stage: string, done = 0, total = 0, success = 0, failed = 0) => progress({stage, done, total, success, failed});
  report('거래소 시각 확인');
  const marketTime = await client.serverTime();
  report('전체 종목 목록 조회');
  const instruments = await client.instruments();
  report('현재 24시간 거래대금 확인');
  const tickers = new Map((await client.tickers()).map(t => [t.symbol, t]));
  const failures: Failure[] = [];
  const eligible = instruments.filter(x => {
    const raw = tickers.get(x.symbol)?.turnover24h;
    const value = raw?.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 0) { failures.push({symbol: x.symbol, reason: '24시간 거래대금 누락 또는 오류'}); return false; }
    return value >= 1_000_000;
  });
  const entries: Entry[] = [];
  let cursor = 0, done = 0;
  report('확정 15분봉 분석', done, eligible.length, 0, failures.length);
  const worker = async () => {
    while (cursor < eligible.length) {
      signal.throwIfAborted();
      const symbol = eligible[cursor++].symbol;
      try {
        const candles = validateHistory(await client.candles(symbol, marketTime), marketTime);
        const result = detect(candles);
        entries.push({symbol, turnover: Number(tickers.get(symbol)!.turnover24h), ...result,
          signals: result.signals.filter(x => x.closeTime >= marketTime - 24 * 3600_000)});
      } catch (e) { if (signal.aborted) throw e; failures.push({symbol, reason: errorMessage(e)}); }
      report('확정 15분봉 분석', ++done, eligible.length, entries.length, failures.length);
    }
  };
  await Promise.all(Array.from({length: Math.min(4, eligible.length)}, worker));
  signal.throwIfAborted();
  return {entries, failures, eligible: eligible.length, universe: instruments.length, marketTime, finishedAt: Date.now()};
}
