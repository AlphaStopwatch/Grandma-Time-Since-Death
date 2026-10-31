'use strict';
// ===== Engine (single immutable source of truth) =====
const MEMORIAL={y:2026,mo:10,d:31,h:17,mi:12,s:0}; // 31 Oct 2026 17:12:00 Asia/Dhaka (UTC+06:00, no DST)
const OFFSET_MS=6*3600000;
const START_MS=Date.UTC(2026,9,31,17,12,0)-OFFSET_MS; // = 2026-10-31T17:12:00+06:00
Object.freeze(MEMORIAL);
const dim=(y,m)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
const wall=ms=>new Date(ms+OFFSET_MS); // read with UTC getters => Dhaka wall clock
function calendarDuration(nowMs,startMs=START_MS){
 const sW=wall(startMs),nW=wall(Math.max(nowMs,startMs));
 const sy=sW.getUTCFullYear(),sm=sW.getUTCMonth(),sd=sW.getUTCDate();
 const anchor=n=>{const t=sm+n,y=sy+Math.floor(t/12),m=((t%12)+12)%12;
  return Date.UTC(y,m,Math.min(sd,dim(y,m)),sW.getUTCHours(),sW.getUTCMinutes(),sW.getUTCSeconds());};
 let n=(nW.getUTCFullYear()-sy)*12+nW.getUTCMonth()-sm;
 const nowWall=nW.getTime();
 while(n>0&&anchor(n)>nowWall)n--;
 let rem=Math.floor((nowWall-anchor(n))/1000);
 const days=Math.floor(rem/86400);rem%=86400;
 return{years:Math.floor(n/12),months:n%12,days,hours:Math.floor(rem/3600),minutes:Math.floor(rem%3600/60),seconds:rem%60};
}
const diffMs=nowMs=>{const d=BigInt(Math.floor(nowMs))-BigInt(START_MS);return d<0n?0n:d;};
const faceCalc={ // each face has its own direct path from (now - memorial)
 years:n=>BigInt(calendarDuration(n).years),
 days:n=>diffMs(n)/86400000n,
 hours:n=>diffMs(n)/3600000n,
 minutes:n=>diffMs(n)/60000n,
 seconds:n=>diffMs(n)/1000n};
const fmt=b=>b.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
// ===== Calendars =====
const WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const GM=['January','February','March','April','May','June','July','August','September','October','November','December'];
const BM=['Boishakh','Joishtho','Asharh','Shrabon','Bhadro','Ashwin','Kartik','Ogrohayon','Poush','Magh','Falgun','Chaitro'];
const leap=y=>y%4===0&&(y%100!==0||y%400===0);
function gregorian(ms){const w=wall(ms);return`${WD[w.getUTCDay()]}, ${w.getUTCDate()} ${GM[w.getUTCMonth()]} ${w.getUTCFullYear()}`;}
function bangla(ms){ // Bangladesh revised calendar: new year 14 April; first five months 31 days, Falgun 31 in leap year, others 30
 const w=wall(ms),y=w.getUTCFullYear();
 const todayDay=Date.UTC(y,w.getUTCMonth(),w.getUTCDate());
 let by=y,ny=Date.UTC(y,3,14);
 if(todayDay<ny){by=y-1;ny=Date.UTC(y-1,3,14);}
 let off=Math.round((todayDay-ny)/86400000),m=0;
 const len=i=>i<5?31:(i===10&&leap(by+1)?31:30);
 while(off>=len(m)){off-=len(m);m++;}
 return`${BM[m]} ${off+1}, ${by-593} Bengali Era`;}
let hijriAdj=0;
function hijri(ms){try{const w=wall(ms);const d=new Date(Date.UTC(w.getUTCFullYear(),w.getUTCMonth(),w.getUTCDate()+hijriAdj,12));
 const p=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).formatToParts(d);
 const g=t=>p.find(x=>x.type===t).value;return`${g('day')} ${g('month')} ${g('year').replace(/\D/g,'')} AH`;}catch(e){return'Unavailable';}}
// ===== Bangladesh time sync =====
let sync={ok:false,base:0,perf:0};
const nowMs=()=>sync.ok?sync.base+(performance.now()-sync.perf):Date.now();
async function syncTime(){
 const srcs=[['https://worldtimeapi.org/api/timezone/Etc/UTC',j=>j.unixtime*1000],['https://timeapi.io/api/Time/current/zone?timeZone=UTC',j=>Date.parse(j.dateTime+'Z')]];
 for(const [u,f] of srcs){try{const t0=performance.now();const c=new AbortController();setTimeout(()=>c.abort(),6000);
  const r=await fetch(u,{signal:c.signal,cache:'no-store'});if(!r.ok)continue;const v=f(await r.json());
  if(!Number.isFinite(v)||v<1.7e12||Math.abs(v-Date.now())>3*365*86400000)continue; // validate
  sync={ok:true,base:v+(performance.now()-t0)/2,perf:performance.now()};return;}catch(e){}}
 sync.ok=false;}
function setStatus(){const el=document.getElementById('status');let t,c;
 if(!navigator.onLine){t='OFFLINE — DEVICE TIME';c='off';}
 else if(sync.ok){t='ONLINE — BANGLADESH TIME SYNCHRONIZED';c='ok';}
 else{t='UNVERIFIED — TIME SOURCE UNAVAILABLE';c='bad';}
 el.textContent=t;el.className='status '+c;}
// ===== Rendering (each face isolated) =====
const $=id=>document.getElementById(id);
const pad=(n,l)=>String(n).padStart(l,'0');
function renderMain(n){try{const d=calendarDuration(n);
 $('m-y').textContent=pad(d.years,3);$('m-mo').textContent=pad(d.months,2);$('m-d').textContent=pad(d.days,2);
 $('m-h').textContent=pad(d.hours,2);$('m-mi').textContent=pad(d.minutes,2);$('m-s').textContent=pad(d.seconds,2);}catch(e){console.error('main',e);}}
function renderFaces(n){for(const k of Object.keys(faceCalc)){try{$('f-'+k).textContent=fmt(faceCalc[k](n));}catch(e){console.error('face',k,e);}}}
let lastDay='';
function renderCals(n){try{const g=gregorian(n);if(g+hijriAdj===lastDay)return;lastDay=g+hijriAdj;
 $('cal-g').textContent=g;$('cal-b').textContent=bangla(n);$('cal-h').textContent=hijri(n);
 $('hijri-note').textContent=(sync.ok?'':'Estimate (device time). ')+'Umm al-Qura convention; adjust ±1 day for local moon sighting.';}catch(e){console.error('cal',e);}}
let timer;
function tick(){clearTimeout(timer);const n=nowMs();renderMain(n);renderFaces(n);renderCals(n);setStatus();
 timer=setTimeout(tick,1000-(n%1000)+5);} // self-correcting; every value recomputed from timestamps
// ===== Dua library =====
let duas=[],bm=new Set(),onlyBm=false;
const store={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d;}catch(e){return d;}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
const LV=['','Level 1 — Very short','Level 2 — Short','Level 3 — Medium','Level 4 — Long','Level 5 — Extended'];
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function renderDuas(){const q=$('q').value.trim().toLowerCase().slice(0,80),mode=$('mode').value,list=$('list');list.replaceChildren();
 let lv=0,shown=0;
 for(const d of duas){if(onlyBm&&!bm.has(d.id))continue;
  if(q&&!(d.title+d.en+d.tr+d.src+d.ref).toLowerCase().includes(q)&&!d.ar.includes(q))continue;
  if(d.level!==lv){lv=d.level;list.append(el('h3','lvl',LV[lv]));}
  const c=el('article','card dua');c.append(el('h3',null,d.title));
  if(mode==='all'||mode==='ar'){const a=el('p','ar',d.ar);a.lang='ar';a.dir='rtl';c.append(a);}
  if(mode==='all'||mode==='tr')c.append(Object.assign(el('p',null,d.tr),{style:'font-style:italic'}));
  if(mode==='all'||mode==='en')c.append(el('p',null,d.en));
  if(mode!=='ar'){c.append(el('p','meta',`Source: ${d.src} — ${d.ref} · Classification: ${d.auth}`));
   c.append(el('p','rep','Recommended repetition: '+(d.rep||'No specific authentic fixed repetition count established. Optional voluntary recitation is permitted; read once or as often as you wish.')));
   c.append(el('p','meta',d.ctx));}
  const r=el('div','row'),b=el('button',null,bm.has(d.id)?'Bookmarked':'Bookmark');b.onclick=()=>{bm.has(d.id)?bm.delete(d.id):bm.add(d.id);store.set('bm',[...bm]);renderDuas();};
  const cp=el('button',null,'Copy');cp.onclick=async()=>{try{await navigator.clipboard.writeText(`${d.ar}\n${d.tr}\n${d.en}\n${d.src}, ${d.ref}`);cp.textContent='Copied';}catch(e){cp.textContent='Copy unavailable';}};
  r.append(b,cp);c.append(r);list.append(c);shown++;}
 $('prog').textContent=`Showing ${shown} of ${duas.length} duas · ${bm.size} bookmarked`;}
function applyPrefs(){document.documentElement.style.setProperty('--fs',$('fs').value+'px');
 document.querySelectorAll('.dua .ar').forEach(e=>{e.style.fontSize=$('fs').value+'px';e.style.lineHeight=$('ls').value/10;});}
async function initDuas(){try{duas=await (await fetch('data/duas.json')).json();duas.sort((a,b)=>a.level-b.level||a.ar.length-b.ar.length);}catch(e){$('list').textContent='Duas could not be loaded.';return;}
 bm=new Set(store.get('bm',[]));const p=store.get('prefs',{fs:32,ls:20,mode:'all'});$('fs').value=p.fs;$('ls').value=p.ls;$('mode').value=p.mode;
 const upd=()=>{store.set('prefs',{fs:+$('fs').value,ls:+$('ls').value,mode:$('mode').value});renderDuas();applyPrefs();};
 ['fs','ls','mode'].forEach(i=>$(i).addEventListener('input',upd));$('q').addEventListener('input',()=>{renderDuas();applyPrefs();});
 $('bm-only').onclick=()=>{onlyBm=!onlyBm;$('bm-only').classList.toggle('on',onlyBm);renderDuas();applyPrefs();};upd();}
// ===== Boot =====
if(typeof document!=='undefined'){
 document.querySelectorAll('[data-adj]').forEach(b=>b.addEventListener('click',()=>{hijriAdj=+b.dataset.adj;store.set('hadj',hijriAdj);
  document.querySelectorAll('[data-adj]').forEach(x=>x.classList.toggle('on',x===b));lastDay='';tick();}));
 hijriAdj=store.get('hadj',0);document.querySelectorAll('[data-adj]').forEach(x=>x.classList.toggle('on',+x.dataset.adj===hijriAdj));
 $('amen').onclick=()=>{$('amen-msg').textContent='Ameen. May Allah accept your sincere prayers for Dadi.';};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();syncTime().then(tick);}});
 addEventListener('online',()=>syncTime().then(tick));addEventListener('offline',()=>{sync.ok=false;tick();});
 tick();syncTime().then(tick);setInterval(()=>navigator.onLine&&syncTime().then(tick),600000);initDuas();
 if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}else module.exports={calendarDuration,faceCalc,START_MS,bangla,gregorian,fmt};
