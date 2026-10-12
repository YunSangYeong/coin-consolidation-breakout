import { expect, it, vi } from 'vitest';
import { scanMarket } from './scanner';
import { INTERVAL, type Candle } from './types';
const candles: Candle[] = Array.from({length:1000},(_,i)=>({time:i*INTERVAL,open:100,high:101,low:99,close:100,volume:10,turnover:1000}));
function client(n=75) {
  const symbols=Array.from({length:n},(_,i)=>'COIN'+i+'USDT');
  return {serverTime:vi.fn(async()=>1000*INTERVAL), instruments:vi.fn(async()=>symbols.map(symbol=>({symbol,quoteCoin:'USDT',contractType:'LinearPerpetual',status:'Trading'}))),
    tickers:vi.fn(async()=>symbols.map(symbol=>({symbol,turnover24h:'10000000',lastPrice:'100'}))), candles:vi.fn(async()=>candles)};
}
it('scans every qualifying instrument beyond top 50 including threshold equality',async()=>{
  const c=client(); const r=await scanMarket(new AbortController().signal,()=>{},c);
  expect(c.candles).toHaveBeenCalledTimes(75); expect(r.eligible).toBe(75); expect(r.entries).toHaveLength(75);
});
it('uses turnover24h, reports invalid liquidity and excludes below threshold',async()=>{
  const c=client(3); c.tickers.mockResolvedValue([{symbol:'COIN0USDT',turnover24h:'9999999',lastPrice:'100'}, {symbol:'COIN1USDT',turnover24h:'',lastPrice:'100'}, {symbol:'COIN2USDT',turnover24h:'10000000',lastPrice:'100'}]);
  const r=await scanMarket(new AbortController().signal,()=>{},c); expect(r.eligible).toBe(1); expect(r.failures[0].symbol).toBe('COIN1USDT');
});
it('preserves successful symbols and reports individual failed histories',async()=>{
  const c=client(2); c.candles.mockRejectedValueOnce(new Error('fixture failure'));
  const r=await scanMarket(new AbortController().signal,()=>{},c); expect(r.entries).toHaveLength(1); expect(r.failures[0].reason).toBe('fixture failure');
});
it('limits concurrent symbol requests to four and propagates cancellation',async()=>{
  const c=client(12); let active=0,max=0;
  c.candles.mockImplementation(async()=>{active++;max=Math.max(max,active); await new Promise(r=>setTimeout(r,2)); active--;return candles;});
  await scanMarket(new AbortController().signal,()=>{},c); expect(max).toBe(4);
  const abort=new AbortController();c.candles.mockImplementation(async()=>{abort.abort(); return candles;});
  await expect(scanMarket(abort.signal,()=>{},c)).rejects.toMatchObject({name:'AbortError'});
});
