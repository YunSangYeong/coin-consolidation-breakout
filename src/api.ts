import { INTERVAL, type Candle } from './types';

const BASE = 'https://api.bybit.com';
export class ApiError extends Error {
  constructor(message: string, readonly retryable = false, readonly delay = 0) { super(message); }
}
function abortError() { return new DOMException('검색이 취소되었습니다.', 'AbortError'); }
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
interface Envelope<T> { retCode: number; retMsg: string; result: T; time: number }
interface Instrument { symbol: string; contractType: string; quoteCoin: string; status: string }
export interface Ticker { symbol: string; turnover24h: string; lastPrice: string }
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '알 수 없는 조회 오류';

/** One client per scan; all attempts (including retries) share the paced request queue. */
export class BybitClient {
  private queue: Promise<void> = Promise.resolve();
  private nextRequest = 0;
  private blocked?: ApiError;
  constructor(private readonly signal: AbortSignal, private readonly fetcher: typeof fetch = fetch,
    private readonly spacing = 200) {}

  private async slot() {
    const slot = this.queue.then(async () => {
      if (this.blocked) throw this.blocked;
      await sleep(Math.max(0, this.nextRequest - Date.now()), this.signal);
      this.nextRequest = Date.now() + this.spacing;
    });
    this.queue = slot.catch(() => {});
    await slot;
  }

  async request<T>(path: string, params: Record<string, string> = {}): Promise<Envelope<T>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.slot();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      this.signal.addEventListener('abort', cancel, { once: true });
      if (this.signal.aborted) controller.abort();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        // Native browser fetch must not receive the client instance as its receiver.
        const fetcher = this.fetcher;
        const response = await fetcher(`${BASE}${path}?${new URLSearchParams(params)}`, {
          signal: controller.signal, credentials: 'omit',
        });
        if (response.status === 403) {
          this.blocked = new ApiError('Bybit 접근 거부 (HTTP 403). 지역 제한 또는 네트워크 정책을 확인하세요.');
          throw this.blocked;
        }
        if (!response.ok) {
          const retryHeader = response.headers.get('Retry-After');
          const retryMs = retryHeader ? (Number.isFinite(Number(retryHeader)) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : 0;
          throw new ApiError(`Bybit HTTP ${response.status}`, response.status === 429 || response.status >= 500, Math.min(60_000, Math.max(0, retryMs || 0)));
        }
        const data = await response.json() as Envelope<T>;
        if (!data || typeof data.retCode !== 'number') throw new ApiError('Bybit 응답 형식이 올바르지 않습니다.');
        if (data.retCode !== 0) throw new ApiError(`Bybit ${data.retCode}: ${data.retMsg}`, [10006, 10016, 10000].includes(data.retCode));
        return data;
      } catch (error) {
        if (this.signal.aborted) throw abortError();
        const failure = error instanceof ApiError ? error : error instanceof SyntaxError ? new ApiError('Bybit 응답이 올바른 JSON 형식이 아닙니다.') : new ApiError(
          controller.signal.aborted ? 'Bybit 응답 시간 초과 (12초)' : 'Bybit 연결 실패: 네트워크·CORS 또는 지역 제한을 확인하세요.', true);
        if (!failure.retryable || attempt === 2) throw failure;
        const delay = Math.max(failure.delay, 1000 * 2 ** attempt);
        this.nextRequest = Math.max(this.nextRequest, Date.now() + delay);
      } finally {
        clearTimeout(timeout);
        this.signal.removeEventListener('abort', cancel);
      }
    }
    throw new ApiError('재시도 횟수를 초과했습니다.');
  }

  async serverTime(): Promise<number> {
    const data = await this.request<{ timeSecond: string }>('/v5/market/time');
    if (!Number.isFinite(data.time) || data.time <= 0) throw new ApiError('거래소 기준 시각을 확인할 수 없습니다.');
    return data.time;
  }

  async instruments(): Promise<Instrument[]> {
    const result = new Map<string, Instrument>();
    const cursors = new Set<string>();
    let cursor = '';
    do {
      const data = await this.request<{ list: Instrument[]; nextPageCursor?: string }>('/v5/market/instruments-info', {
        category: 'linear', status: 'Trading', limit: '1000', ...(cursor ? { cursor } : {}),
      });
      if (!Array.isArray(data.result?.list)) throw new ApiError('종목 목록 응답이 올바르지 않습니다.');
      data.result.list.forEach(item => {
        if (item.contractType === 'LinearPerpetual' && item.quoteCoin === 'USDT' && item.status === 'Trading') result.set(item.symbol, item);
      });
      cursor = data.result.nextPageCursor || '';
      if (cursor && cursors.has(cursor)) throw new ApiError('종목 페이지네이션 커서가 반복되었습니다. 전체 목록을 확인할 수 없습니다.');
      cursors.add(cursor);
    } while (cursor);
    if (!result.size) throw new ApiError('거래 가능한 USDT 무기한 종목이 없습니다.');
    return [...result.values()];
  }

  async tickers(): Promise<Ticker[]> {
    const data = await this.request<{ list: Ticker[] }>('/v5/market/tickers', { category: 'linear' });
    if (!Array.isArray(data.result?.list)) throw new ApiError('거래대금 목록 응답이 올바르지 않습니다.');
    return data.result.list;
  }

  async candles(symbol: string, asOf: number): Promise<Candle[]> {
    const end = Math.floor(asOf / INTERVAL) * INTERVAL - 1;
    const start = end + 1 - 1000 * INTERVAL;
    const data = await this.request<{ list: string[][]; symbol: string }>('/v5/market/kline', {
      category: 'linear', symbol, interval: '15', start: String(start), end: String(end), limit: '1000',
    });
    if (data.result?.symbol !== symbol || !Array.isArray(data.result.list)) throw new ApiError('캔들 응답의 종목 또는 형식이 올바르지 않습니다.');
    return parseCandles(data.result.list);
  }
}

export function parseCandles(rows: string[][]): Candle[] {
  const unique = new Map<number, Candle>();
  rows.forEach(row => {
    const [time, open, high, low, close, volume, turnover] = row.map(value => value.trim() === '' ? NaN : Number(value));
    if (row.length < 7 || ![time, open, high, low, close, volume, turnover].every(Number.isFinite) ||
      !Number.isInteger(time) || time % INTERVAL !== 0 || time < 0 || Math.min(open, high, low, close) <= 0 ||
      high < Math.max(open, close, low) || low > Math.min(open, close) || volume < 0 || turnover < 0) throw new ApiError('유효하지 않은 캔들 데이터');
    if (unique.has(time)) throw new ApiError('중복된 캔들 데이터');
    unique.set(time, { time, open, high, low, close, volume, turnover });
  });
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
