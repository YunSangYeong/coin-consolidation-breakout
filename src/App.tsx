import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';
import { scanMarket } from './scanner';
import type { Box, Failure, Progress, ScanResult } from './types';
const time = (ms: number) => new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(ms) + ' KST';
const number = (n: number) => new Intl.NumberFormat('ko-KR', {maximumSignificantDigits: 8}).format(n);
function BoxInfo({box}: {box: Box}) { return <><div><dt>고정 박스 상단</dt><dd>{number(box.upper)}</dd></div><div><dt>고정 박스 하단</dt><dd>{number(box.lower)}</dd></div><div><dt>박스 폭 / ATR(14)</dt><dd>{((box.upper-box.lower)/box.atr).toFixed(3)}</dd></div></>; }
const chart = (symbol: string) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent('BYBIT:'+symbol+'.P')}&interval=15`;
export default function App() {
  const [result, setResult] = useState<ScanResult>();
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [attemptFailures, setAttemptFailures] = useState<Failure[]>([]);
  const [stale, setStale] = useState(false);
  const [hours, setHours] = useState(6);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  async function search() {
    if (controller.current) return;
    const active = new AbortController(); controller.current = active;
    setError(''); setAttemptFailures([]); setStale(true); setProgress({stage:'검색 준비', done:0,total:0,success:0,failed:0});
    try {
      const next = await scanMarket(active.signal, p => { if (mounted.current) setProgress(p); });
      if (!mounted.current) return;
      if (next.eligible > 0 && next.entries.length === 0) {
        setAttemptFailures(next.failures);
        setError('전체 종목 조회 실패. 이전 결과가 있다면 유지합니다.');
      } else { setResult(next); setStale(false); }
    } catch (e) { if (mounted.current) setError(active.signal.aborted ? '검색을 취소했습니다. 이전 결과가 있다면 유지합니다.' : errorMessage(e)); }
    finally { controller.current = null; if (mounted.current) setProgress(undefined); }
  }
  useEffect(() => {
    mounted.current = true; void search();
    const leave = () => controller.current?.abort();
    window.addEventListener('pagehide', leave);
    const resume = (e: PageTransitionEvent) => { if (e.persisted) void search(); };
    window.addEventListener('pageshow', resume);
    return () => { mounted.current = false; leave(); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', resume); };
  }, []);
  const signals = result?.entries.flatMap(e => e.signals.filter(s=>s.closeTime >= result.marketTime-hours*3600_000).map(s=>({...s,symbol:e.symbol,turnover:e.turnover}))).sort((a,b)=>b.closeTime-a.closeTime) ?? [];
  const waiting = result?.entries.filter(e=>e.waiting).sort((a,b)=>b.turnover-a.turnover) ?? [];
  return <main><header><span className="eyebrow">BYBIT · USDT 무기한 · 15분봉</span><h1>코인 밀집돌파 탐지기</h1><p>좁은 박스에서 거래량을 동반한 상승(롱)·하락(숏) 돌파를 찾습니다.</p></header>
    <aside className="notice">수익성이 검증되지 않은 실험용 설정입니다. 자동 주문·매매 추천 기능은 없습니다.</aside>
    <section className="panel"><div className="actions"><button disabled={!!progress} onClick={()=>void search()}>지금 검색</button><button className="secondary" disabled={!progress} onClick={()=>controller.current?.abort()}>검색 취소</button></div>
      <div role="status" aria-live="polite">{progress ? <><p>{progress.stage} · {progress.done} / {progress.total}종목</p><progress value={progress.done} max={progress.total || 1}/><p>조회 성공 {progress.success} · 실패 {progress.failed}</p></> : <p>검색 대기 · 접속 시 자동 검색, 이후 수동 검색</p>}</div>
      {result && <><p>거래 중인 대상 {result.universe} · 유동성 충족 {result.eligible}종목 · 성공 {result.entries.length} · 실패 {result.failures.length}</p><p>마지막 검색 기준: {time(result.marketTime)}</p><p>검색 완료: {time(result.finishedAt)}</p></>}
      {stale && result && <p className="warning">이전 검색 결과입니다. 현재 검색의 최신 결과가 아닙니다.</p>}
      {error && <p role="alert" className="warning">{error}</p>}
      {attemptFailures.length > 0 && <details open><summary>이번 검색 실패 종목·원인 {attemptFailures.length}개</summary><ul>{attemptFailures.map((f,i)=><li key={i}><strong>{f.symbol}</strong> · {f.reason}</li>)}</ul></details>}
      {result?.failures.length ? <details><summary>실패 종목·원인 {result.failures.length}개</summary><ul>{result.failures.map((f,i)=><li key={i}><strong>{f.symbol}</strong> · {f.reason}</li>)}</ul></details> : null}
    </section>
    <section><h2>돌파 발생 <span>{signals.length}</span></h2><p className="muted">검색 기준 시각 이전의 확정 신호입니다. 현재 밀집 상태를 뜻하지 않습니다.</p><div className="filters" aria-label="돌파 표시 기간">{[3,6,24].map(h=><button key={h} aria-pressed={hours===h} className="secondary" onClick={()=>setHours(h)}>최근 {h}시간</button>)}</div>
      <div className="cards">{signals.map(s=><article className={`card breakout ${s.direction}`} key={s.symbol+':'+s.box.id}><h3>{s.symbol} <span className={`badge ${s.direction}`}>{s.direction === 'long' ? '상승 돌파 · 롱' : '하락 돌파 · 숏'}</span></h3><p>{time(s.closeTime)} 마감</p><dl><div><dt>돌파 종가</dt><dd>{number(s.close)} USDT</dd></div><div><dt>직전 50봉 대비 거래량</dt><dd>{s.volumeMultiple.toFixed(2)}배</dd></div><BoxInfo box={s.box}/><div><dt>현재 24h 거래대금</dt><dd>{number(s.turnover)} USDT</dd></div></dl><a href={chart(s.symbol)} target="_blank" rel="noopener noreferrer">TradingView 15분 차트 ↗</a></article>)}</div>
      {!signals.length && <p className="empty">{result ? '선택 기간의 돌파 신호가 없습니다.' : '검색 결과가 아직 없습니다.'}</p>}
    </section>
    <section><h2>밀집 대기 <span>{waiting.length}</span></h2><p className="muted">검색 기준의 최신 확정봉에서 유효한 박스입니다. 돌파 신호가 아닙니다.</p><div className="cards">{waiting.map(e=><article className="card" key={e.symbol}><h3>{e.symbol} <span className="badge waiting">밀집 대기</span></h3><p>박스 확정 {time(e.waiting!.formedAt)}</p><dl><BoxInfo box={e.waiting!}/><div><dt>대기 경과</dt><dd>{e.waiting!.waited} / 10봉</dd></div><div><dt>현재 24h 거래대금</dt><dd>{number(e.turnover)} USDT</dd></div></dl><a href={chart(e.symbol)} target="_blank" rel="noopener noreferrer">TradingView 15분 차트 ↗</a></article>)}</div>{!waiting.length && <p className="empty">{result ? '현재 밀집 대기 종목이 없습니다.' : '검색 결과가 아직 없습니다.'}</p>}</section>
    <footer><p>유동성은 조회 시점 turnover24h 스냅샷입니다. 과거 돌파 시점의 유동성을 검증하지 않습니다.</p><p>확정 1,000봉(약 10.4일)을 재생합니다. 신규 상장·누락 데이터는 실패로 표시합니다. 창을 닫으면 검색하지 않으며 재접속 시 새로 조회합니다.</p><p>공개 API 차단·지역 제한·CORS 문제는 오류로 표시하며 대체 시세를 사용하지 않습니다.</p></footer>
  </main>;
}
