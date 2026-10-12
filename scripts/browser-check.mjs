import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
// Synthetic fixtures live only in this test script; production has no fallback data.
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/coin-consolidation-breakout/';
const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const interval=900000, now=Math.floor(Date.now()/interval)*interval;
const data=result=>({retCode:0,retMsg:'OK',result,time:now});
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];
let mode='success',calls=0;
const rows=symbol=>{
  const c=Array.from({length:1000},(_,i)=>[String(now-(1000-i)*interval),'100','101','99','100','10','1000']);
  if(symbol==='SOLUSDT') c[49]=[c[49][0],'100','200','1','100','10','1000'];
  else if(symbol==='ETHUSDT') c[950]=[c[950][0],'100','100','97','97.2','20','1944'];
  else c[950]=[c[950][0],'100','103','100','102.8','20','2056'];
  return c.toReversed();
};
await context.route('https://api.bybit.com/**',async route=>{
  const url=new URL(route.request().url());
  if(mode==='blocked'){await route.fulfill({status:403,body:'Region or network block fixture'});return;}
  if(mode==='slow') await new Promise(r=>setTimeout(r,800));
  let result;
  if(url.pathname.endsWith('/time'))result={timeSecond:String(now/1000)};
  if(url.pathname.endsWith('/instruments-info'))result={list:symbols.map(symbol=>({symbol,quoteCoin:'USDT',contractType:'LinearPerpetual',status:'Trading'})),nextPageCursor:''};
  if(url.pathname.endsWith('/tickers'))result={list:symbols.map(symbol=>({symbol,turnover24h:'20000000',lastPrice:'100'}))};
  if(url.pathname.endsWith('/kline')){
    calls++; const symbol=url.searchParams.get('symbol');
    if(mode==='partial'&&symbol==='ETHUSDT'){await route.fulfill({json:{retCode:10001,retMsg:'Fixture symbol failure',result:{},time:now}});return;}
    result={symbol,list:rows(symbol)};
  }
  try {await route.fulfill({json:data(result)});} catch(e){if(mode!=='slow')throw e;}
});
const idle=()=>page.waitForFunction(()=>document.querySelector('button')?.disabled===false);
const overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
try{
  await page.goto(base);await idle(); assert.equal(calls,3,'automatic full scan');
  assert.equal(await page.locator('.breakout').count(),0,'default 6h excludes 12h-old signals');
  assert.equal(await page.locator('.badge.waiting').count(),1,'current waiting separate');
  await page.getByRole('button',{name:'최근 24시간',exact:true}).click();
  assert.equal(await page.locator('.breakout').count(),2);
  assert.equal(await page.locator('.breakout.long').count(),1);
  assert.equal(await page.locator('.breakout.short').count(),1);
  await page.getByText('상승 돌파 · 롱',{exact:true}).waitFor();
  await page.getByText('하락 돌파 · 숏',{exact:true}).waitFor();
  const link=await page.locator('.breakout a').first().getAttribute('href');assert.match(link,/BYBIT%3ABTCUSDT.P.*interval=15/);
  await page.getByRole('button',{name:'최근 3시간',exact:true}).click();assert.equal(await page.locator('.breakout').count(),0);
  await page.getByRole('button',{name:'최근 24시간',exact:true}).click();
  for(const width of [360,375,768,1280]){await page.setViewportSize({width,height:812});await overflow();}
  mode='partial';await page.getByRole('button',{name:'지금 검색',exact:true}).click();await idle();
  assert.equal(await page.locator('.breakout').count(),1);
  await page.getByText('실패 종목·원인 1개',{exact:true}).click();await page.getByText(/Fixture symbol failure/).waitFor();
  mode='blocked';await page.getByRole('button',{name:'지금 검색',exact:true}).click();await idle();
  await page.getByRole('alert').filter({hasText:'403'}).waitFor();
  await page.getByText('이전 검색 결과입니다. 현재 검색의 최신 결과가 아닙니다.',{exact:true}).waitFor();
  assert.equal(await page.locator('.breakout').count(),1,'full failure keeps previous result');
  mode='slow';await page.getByRole('button',{name:'지금 검색',exact:true}).click();await page.getByRole('button',{name:'검색 취소',exact:true}).click();await idle();
  await page.getByRole('alert').filter({hasText:'취소'}).waitFor(); assert.equal(await page.locator('.breakout').count(),1);
  mode='success';await page.reload();await idle();assert.equal(await page.getByRole('button',{name:'최근 6시간',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.badge.waiting').count(),1);
  await page.getByRole('button',{name:'최근 24시간',exact:true}).click();
  await page.setViewportSize({width:375,height:812});await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/mobile-fixture.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'test-results/desktop-fixture.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: 360/375px mobile + desktop, automatic full scan, 3/6/24h display, long/short labels and breakout/wait separation, chart link, partial failure, full failure retains labeled old results, cancel, reload. Synthetic fixtures only.');
  const live=await browser.newContext();const livePage=await live.newPage();await livePage.goto(base);
  const probe=await livePage.evaluate(async()=>{try{const r=await fetch('https://api.bybit.com/v5/market/time',{signal:AbortSignal.timeout(15000)});return {ok:r.ok,status:r.status,body:(await r.text()).slice(0,180)};}catch(e){return {ok:false,error:String(e)};}});
  console.log('LIVE unmocked Bybit browser probe:',JSON.stringify(probe));await live.close();
}catch(e){console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
