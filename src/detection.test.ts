import { describe, expect, it } from 'vitest';
import { closedCandles, detect, validateHistory, wilderAtr } from './detection';
import { INTERVAL, type Candle } from './types';
export const bars = (n: number): Candle[] => Array.from({length:n},(_,i)=>({time:i*INTERVAL,open:100,high:101,low:99,close:100,volume:10,turnover:1000}));
const breakout = (c: Candle, volume=20): Candle => ({...c,high:103,low:100,close:102.8,volume});
describe('fixed consolidation state machine', () => {
  it('forms from exactly the most recent 50 closed candles and excludes breakout from box and volume average', () => {
    const c=bars(51); c[50]=breakout(c[50]);
    const r=detect(c); expect(r.signals).toHaveLength(1);
    expect(r.signals[0].box).toMatchObject({upper:101,lower:99,atr:2,start:0,formedAt:50*INTERVAL});
    expect(r.signals[0].volumeMultiple).toBe(2); expect(r.waiting).toBeUndefined();
  });
  it('uses all 50 prior volumes rather than 49 or including the candidate', () => {
    const c=bars(51); c[0].volume=510; c[50]=breakout(c[50],39.9);
    expect(detect(c).signals).toHaveLength(0);
    c[50].volume=40; expect(detect(c).signals[0].volumeMultiple).toBe(2);
  });
  it('freezes ATR and boundaries during wait and accepts equality threshold', () => {
    const c=bars(52); c[50]={...c[50],high:150,low:50,close:100};
    c[51]={...c[51],high:101.2,low:100,close:101.2,volume:20};
    const r=detect(c); expect(r.signals).toHaveLength(1); expect(r.signals[0].box.atr).toBe(2); expect(r.signals[0].box.upper).toBe(101);
  });
  it('fires at most once and blocks overlapping re-detection windows', () => {
    const c=bars(100); c[50]=breakout(c[50]); c[51]=breakout(c[51]);
    const r=detect(c); expect(r.signals).toHaveLength(1); expect(r.waiting).toBeUndefined();
    expect(detect(bars(109)).waiting).toBeUndefined();
    expect(detect(bars(110)).waiting?.formedAt).toBe(110*INTERVAL);
  });
  it('waits next candle through tenth candle inclusive, then expires', () => {
    expect(detect(bars(59)).waiting?.waited).toBe(9);
    expect(detect(bars(60)).waiting).toBeUndefined();
    const c=bars(60); c[59]=breakout(c[59]); expect(detect(c).signals).toHaveLength(1);
    const d=bars(61); d[60]=breakout(d[60]); expect(detect(d).signals).toHaveLength(0);
  });
  it('invalidates below lower boundary, excludes zero range / zero mean volume / low closing position', () => {
    const c=bars(52); c[50]={...c[50],low:98,close:98}; c[51]=breakout(c[51]); expect(detect(c).signals).toHaveLength(0); expect(detect(c).waiting).toBeUndefined();
    const d=bars(51); d[50]={...d[50],open:103,high:103,low:103,close:103,volume:100}; expect(detect(d).signals).toHaveLength(0);
    const z=bars(51); z.forEach(x=>x.volume=0); z[50]=breakout(z[50],100); expect(detect(z).signals).toHaveLength(0);
    const p=bars(51); p[50]={...breakout(p[50]),high:110}; expect(detect(p).signals).toHaveLength(0);
  });
  it('requires width <= 3 ATR and small first/last close drift', () => {
    const c=bars(50); c[0].high=150; expect(detect(c).waiting).toBeUndefined();
    const d=bars(50); d[0].close=99; d[49].close=101; expect(detect(d).waiting).toBeUndefined();
    expect(detect(bars(49)).waiting).toBeUndefined();
  });
  it('is causal: appending future candles cannot alter prior signal values', () => {
    const c=bars(55); c[50]=breakout(c[50]); const before=detect(c.slice(0,51)).signals;
    expect(detect(c).signals).toEqual(before);
  });
  it('uses Wilder smoothing rather than simple rolling average', () => {
    const c=bars(16); c[14].high=115;
    const a=wilderAtr(c); expect(a[12]).toBeNaN(); expect(a[13]).toBe(2);
    expect(a[14]).toBe(3); expect(a[15]).toBeCloseTo(41/14);
  });
});
describe('history readiness', () => {
  it('excludes unfinished bars at exchange time and retains exact close', () => {
    expect(closedCandles(bars(3),2*INTERVAL+1)).toHaveLength(2);
    expect(closedCandles(bars(3),2*INTERVAL)).toHaveLength(2);
  });
  it('requires complete 1000-bar history, continuity and latest confirmed bar', () => {
    expect(validateHistory(bars(1001),1000*INTERVAL)).toHaveLength(1000);
    expect(()=>validateHistory(bars(999),1000*INTERVAL)).toThrow('부족');
    const c=bars(1000); c[50].time-=INTERVAL; expect(()=>validateHistory(c,1000*INTERVAL)).toThrow('누락');
    expect(()=>validateHistory(bars(1000),1001*INTERVAL)).toThrow('최신');
  });
});
