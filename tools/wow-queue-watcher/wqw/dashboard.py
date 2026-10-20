"""Local web dashboard: queue position, ETA, graph, latest screenshot, event
timeline and the same controls as the phone."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Queue Watcher</title><meta name="theme-color" content="#0e1116"><meta name="apple-mobile-web-app-capable" content="yes">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23e8b341'/%3E%3Cpath d='M10 7h12M10 25h12M11 7v3a5 5 0 0 0 10 0V7M11 25v-3a5 5 0 0 1 10 0v3' fill='none' stroke='%23161a22' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
:root{
 --bg:#0e1116;--surface:#161a22;--surface-2:#1c212b;--border:#262c38;--border-strong:#323a49;
 --text:#e8ebf1;--text-2:#a3abba;--text-3:#6f7889;
 --gold:#e8b341;--gold-soft:rgba(232,179,65,.14);--green:#3fbf7f;--green-soft:rgba(63,191,127,.14);
 --red:#ef5a5a;--red-soft:rgba(239,90,90,.14);--blue:#5b9cf5;--blue-soft:rgba(91,156,245,.14);
 --amber:#f29b38;--amber-soft:rgba(242,155,56,.14);--grey-soft:rgba(160,170,190,.12);
 --shadow:0 1px 2px rgba(0,0,0,.25);--radius:14px;
 --mono:ui-monospace,"Cascadia Mono",Consolas,monospace;
}
@media (prefers-color-scheme:light){:root{
 --bg:#f5f6f8;--surface:#ffffff;--surface-2:#f8f9fb;--border:#e4e7ec;--border-strong:#d3d8e0;
 --text:#151a23;--text-2:#556072;--text-3:#8a93a3;--gold:#b7861b;--gold-soft:rgba(183,134,27,.12);
 --green:#1f9d61;--red:#d64545;--blue:#2f74d8;--amber:#c97716;--shadow:0 1px 2px rgba(16,24,40,.06)}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1180px;margin:0 auto;padding:20px 16px 40px}
button,input{font:inherit;color:inherit}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--text-2)}.faint{color:var(--text-3)}

/* top bar */
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.logo{width:36px;height:36px;border-radius:10px;background:var(--gold);display:grid;place-items:center;flex:none}
.brand h1{font-size:16px;font-weight:650;margin:0;letter-spacing:-.01em}
.brand .sub{font-size:12.5px;color:var(--text-3)}
.live{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px var(--green-soft)}
.dot.off{background:var(--red);box-shadow:0 0 0 3px var(--red-soft)}

/* alarm banner */
.banner{display:flex;align-items:center;gap:14px;padding:14px 16px;margin-bottom:16px;border-radius:var(--radius);
 background:var(--red-soft);border:1px solid color-mix(in srgb,var(--red) 45%,transparent)}
.banner .icon{width:36px;height:36px;border-radius:50%;background:var(--red);display:grid;place-items:center;flex:none;animation:pulse 1.4s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--red) 55%,transparent)}100%{box-shadow:0 0 0 14px transparent}}
.banner b{display:block;font-size:15px}.banner span{color:var(--text-2);font-size:13px}
.banner .grow{flex:1;min-width:0}

/* cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px 0}
.card-h h2{font-size:13px;font-weight:600;margin:0;color:var(--text-2);letter-spacing:.01em}
.card-b{padding:14px 18px 18px}
.grid{display:grid;gap:16px}
.g-main{grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);margin-top:16px}
.g-bottom{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);margin-top:16px}
@media (max-width:860px){.g-main,.g-bottom{grid-template-columns:1fr}}

/* hero */
.hero{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:0}
.hero>div{padding:22px 24px}
.hero .right{border-left:1px solid var(--border)}
@media (max-width:760px){.hero{grid-template-columns:1fr}.hero .right{border-left:0;border-top:1px solid var(--border)}}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:99px;background:var(--grey-soft);color:var(--text-2)}
.chip i{width:7px;height:7px;border-radius:50%;background:currentColor}
.chip.gold{background:var(--gold-soft);color:var(--gold)}.chip.green{background:var(--green-soft);color:var(--green)}
.chip.red{background:var(--red-soft);color:var(--red)}.chip.blue{background:var(--blue-soft);color:var(--blue)}
.chip.amber{background:var(--amber-soft);color:var(--amber)}
.label{font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.big{font-size:56px;font-weight:700;letter-spacing:-.03em;line-height:1.05;margin:6px 0 16px}
.big.small{font-size:30px;letter-spacing:-.02em}
.bar{height:8px;border-radius:99px;background:var(--surface-2);border:1px solid var(--border);overflow:hidden}
.bar>div{height:100%;width:0;background:linear-gradient(90deg,color-mix(in srgb,var(--gold) 70%,transparent),var(--gold));border-radius:99px;transition:width .6s ease}
.bar-meta{display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-3);margin-top:8px}
.eta-big{font-size:40px;font-weight:700;letter-spacing:-.02em;margin:4px 0 2px}
.kv{display:grid;grid-template-columns:1fr auto;gap:9px 12px;margin:18px 0 0;font-size:13.5px}
.kv dt{color:var(--text-2)}.kv dd{margin:0;text-align:right;font-weight:600}
.idle{display:flex;flex-direction:column;gap:6px}
.countdown{font-size:48px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}

/* chart */
.chart-wrap{position:relative;height:250px}
#chart{width:100%;height:100%;display:block}
.tip{position:absolute;pointer-events:none;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:10px;
 padding:8px 10px;font-size:12.5px;box-shadow:0 6px 20px rgba(0,0,0,.25);white-space:nowrap;opacity:0;transition:opacity .1s}
.legend{display:flex;gap:14px;font-size:12px;color:var(--text-2)}
.legend span{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.legend span.off{opacity:.4}
.legend b{width:12px;height:3px;border-radius:2px;display:inline-block}
.empty{height:100%;display:grid;place-items:center;color:var(--text-3);font-size:13px;text-align:center}

/* screenshot */
.shot{position:relative;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:16/9;border:1px solid var(--border);cursor:zoom-in}
.shot img{width:100%;height:100%;object-fit:cover;display:block}
.shot .stamp{position:absolute;left:8px;bottom:8px;font-size:11.5px;padding:2px 8px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);display:grid;place-items:center;padding:24px;z-index:20;cursor:zoom-out}
.lightbox img{max-width:100%;max-height:100%;border-radius:8px}

/* controls */
.btns{display:flex;flex-wrap:wrap;gap:8px}
.btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:9px;border:1px solid var(--border-strong);
 background:var(--surface-2);cursor:pointer;font-weight:550;font-size:13.5px;transition:background .15s,border-color .15s,transform .05s}
.btn:hover{border-color:var(--text-3)}.btn:active{transform:translateY(1px)}
.btn svg{width:15px;height:15px}
.btn.primary{background:var(--gold);border-color:var(--gold);color:#17130a}
.btn.primary:hover{filter:brightness(1.06)}
.btn.danger{background:var(--red);border-color:var(--red);color:#fff}
.btn.ghost-danger{color:var(--red)}
.btn[hidden]{display:none}
.sep{height:1px;background:var(--border);margin:16px 0}
.cmd{display:flex;gap:8px}
.cmd input{flex:1;min-width:0;height:38px;padding:0 12px;border-radius:9px;border:1px solid var(--border-strong);background:var(--bg);outline:none}
.cmd input:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-soft)}
.hints{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.hint{font-size:12px;padding:3px 9px;border-radius:99px;border:1px dashed var(--border-strong);color:var(--text-2);cursor:pointer;background:none}
.hint:hover{border-color:var(--gold);color:var(--gold)}

/* timeline */
.timeline{list-style:none;margin:0;padding:0;max-height:330px;overflow:auto}
.timeline li{display:grid;grid-template-columns:52px 14px 1fr;gap:8px;align-items:start;padding:7px 0;font-size:13px}
.timeline time{color:var(--text-3);font-variant-numeric:tabular-nums;font-size:12.5px;padding-top:1px}
.timeline .mark{width:8px;height:8px;border-radius:50%;margin-top:6px;background:var(--text-3)}
.mark.gold{background:var(--gold)}.mark.green{background:var(--green)}.mark.red{background:var(--red)}
.mark.blue{background:var(--blue)}.mark.amber{background:var(--amber)}

.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;background:var(--text);color:var(--bg);
 padding:9px 16px;border-radius:99px;font-size:13px;font-weight:550;transition:all .2s;pointer-events:none;z-index:30}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media (max-width:520px){.card-h{flex-wrap:wrap}.legend{flex-wrap:wrap;gap:4px 12px}.legend span{white-space:nowrap}
 .quick{display:grid!important;grid-template-columns:1fr 1fr}.quick .btn{justify-content:center}.chart-wrap{height:210px}.top .sub{font-size:12px}
 .big{font-size:44px}.eta-big{font-size:32px}.hero>div{padding:18px}.card-h{padding:12px 14px 0}.card-b{padding:12px 14px 14px}}
</style></head><body><main>

<header class="top">
 <div class="brand">
  <div class="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#17130a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 10 0V3M7 21v-3a5 5 0 0 1 10 0v3"/></svg></div>
  <div><h1>Queue Watcher</h1><div class="sub" id="game">World of Warcraft</div></div>
 </div>
 <div class="live"><span class="dot" id="dot"></span><span id="updated">Connecting…</span></div>
</header>

<div class="banner" id="banner" hidden>
 <div class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg></div>
 <div class="grow"><b id="alarmTitle">Alarm</b><span>Your phone is ringing. Stop it here or tap "I'm up" on the phone.</span></div>
 <button class="btn danger" onclick="cmd('ack')">Stop alarm</button>
</div>

<section class="card hero">
 <div class="left" id="heroLeft">
  <span class="chip" id="chip"><i></i><span id="chipText">Starting</span></span>
  <div id="queueView">
   <div class="label" style="margin-top:18px">Position in queue</div>
   <div class="big num" id="pos">—</div>
   <div class="bar"><div id="barFill"></div></div>
   <div class="bar-meta num"><span id="progress">Waiting for queue data</span><span id="startPos"></span></div>
  </div>
  <div id="idleView" class="idle" hidden>
   <div class="label" style="margin-top:18px" id="idleLabel">Standby</div>
   <div class="countdown" id="countdown">—</div>
   <div class="muted" id="idleText"></div>
  </div>
 </div>
 <div class="right" id="schedView" hidden>
  <div class="label">Scheduled start</div>
  <div class="eta-big num" id="schedAt">Not set</div>
  <div class="muted" id="schedSub">Start the queue later, so it finishes when you're back.</div>
  <div class="label" style="margin-top:22px">Start the queue in</div>
  <div class="btns quick" style="margin-top:10px">
   <button class="btn" onclick="cmd('start in 30m')">30 min</button><button class="btn" onclick="cmd('start in 1h')">1 hour</button>
   <button class="btn" onclick="cmd('start in 2h')">2 hours</button><button class="btn" onclick="cmd('start in 3h')">3 hours</button>
  </div>
 </div>
 <div class="right" id="etaView">
  <div class="label">Estimated entry</div>
  <div class="eta-big num" id="inat">—</div>
  <div class="muted num" id="left">No estimate yet</div>
  <dl class="kv num">
   <dt>Blizzard estimate</dt><dd id="bl">—</dd>
   <dt>Measured pace</dt><dd id="pace">—</dd>
   <dt>Queue speed</dt><dd id="rate">—</dd>
   <dt>Relaunches</dt><dd id="rl">0</dd>
  </dl>
 </div>
</section>

<div class="grid g-main">
 <section class="card">
  <div class="card-h"><h2>Queue progress</h2>
   <div class="legend"><span data-k="pos"><b style="background:var(--gold)"></b>Position</span><span data-k="bl"><b style="background:var(--blue)"></b>Blizzard ETA</span><span data-k="pace"><b style="background:var(--green)"></b>Pace ETA</span></div></div>
  <div class="card-b"><div class="chart-wrap"><svg id="chart"></svg><div class="tip" id="tip"></div></div></div>
 </section>
 <section class="card">
  <div class="card-h"><h2>Game screen</h2><span class="faint" style="font-size:12px">Click to enlarge</span></div>
  <div class="card-b"><div class="shot" id="shotBox"><img id="shot" alt="" style="visibility:hidden" onerror="this.style.visibility='hidden'" onload="this.style.visibility='visible'"><div class="empty" id="shotEmpty" style="position:absolute;inset:0;color:#8a93a3">No screenshot yet</div><span class="stamp" id="shotTime">—</span></div></div>
 </section>
</div>

<div class="grid g-bottom">
 <section class="card">
  <div class="card-h"><h2>Controls</h2><span class="faint" id="modeText" style="font-size:12px"></span></div>
  <div class="card-b">
   <div class="btns">
    <button class="btn primary" id="bStart" onclick="cmd('start')"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>Start now</button>
    <button class="btn primary" id="bEnter" onclick="cmd('enter')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>Enter world</button>
    <button class="btn" id="bPause" onclick="cmd(this.dataset.c)"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg><span>Pause</span></button>
    <button class="btn" id="bCancel" onclick="cmd('cancel')">Cancel start</button>
    <button class="btn" id="bStandby" onclick="cmd('standby')">Standby</button>
    <button class="btn" id="bRelaunch" onclick="if(confirm('Close and relaunch WoW?'))cmd('reconnect')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg>Relaunch</button>
    <button class="btn ghost-danger" onclick="if(confirm('Stop the watcher completely?'))cmd('quit')">Quit watcher</button>
   </div>
   <div class="sep"></div>
   <form class="cmd" onsubmit="event.preventDefault();send()"><input id="cmdtext" placeholder="Type a command, e.g. start 18:30" autocomplete="off"><button class="btn" type="submit">Send</button></form>
   <div class="hints"><button class="hint" type="button">start in 30m</button><button class="hint" type="button">start in 1h</button><button class="hint" type="button">start 18:00</button><button class="hint" type="button">status</button></div>
   <div class="sep"></div>
   <div class="label" style="margin-bottom:10px">Alert settings</div>
   <dl class="kv num" style="margin:0">
    <dt>Phone topic</dt><dd id="topic" style="font-family:var(--mono);font-weight:500;font-size:12.5px">—</dd>
    <dt>Heads-up push</dt><dd id="thHead">—</dd>
    <dt>Wake-up alarm</dt><dd id="thAlarm">—</dd>
    <dt>Auto-reconnect</dt><dd id="thRec">—</dd>
   </dl>
  </div>
 </section>
 <section class="card">
  <div class="card-h"><h2>Activity</h2><span class="faint" id="since" style="font-size:12px"></span></div>
  <div class="card-b"><ul class="timeline" id="events"></ul></div>
 </section>
</div>
</main>
<div class="toast" id="toast"></div>
<script>
const $=id=>document.getElementById(id);
const STATES={QUEUE:['In queue','gold'],CHAR_SELECT:['Character select','green'],IN_GAME:['In the world','green'],
 CONNECTING:['Connecting','blue'],DISCONNECTED:['Disconnected','red'],LOGIN:['Logged out','amber'],PASSWORD:['Needs password','red'],
 REALM_LIST:['Realm list','amber'],NO_PROCESS:['Game not running','amber'],NO_WINDOW:['Window hidden','amber'],UNKNOWN:['Reading screen','blue']};
let D=null,lastOk=0,hidden=new Set(),chartPts=null;
const fm=m=>m==null?'—':m>=60?Math.floor(m/60)+'h '+String(Math.round(m%60)).padStart(2,'0')+'m':Math.max(0,Math.round(m))+' min';
const hm=t=>new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});
const nf=n=>n==null?'—':Number(n).toLocaleString();
function toast(t){const el=$('toast');el.textContent=t;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2200)}
async function cmd(c){try{await fetch('/api/cmd',{method:'POST',body:c});toast('Sent: '+c);setTimeout(load,1300);setTimeout(load,2600)}catch(e){toast('Watcher not reachable')}}
function send(){const i=$('cmdtext');const v=i.value.trim();if(v){cmd(v);i.value=''}}
document.querySelectorAll('.hint').forEach(h=>h.onclick=()=>{$('cmdtext').value=h.textContent;$('cmdtext').focus()});
document.querySelectorAll('.legend span').forEach(s=>s.onclick=()=>{const k=s.dataset.k;hidden.has(k)?hidden.delete(k):hidden.add(k);s.classList.toggle('off');D&&chart(D.samples||[])});
$('shotBox').onclick=()=>{const lb=document.createElement('div');lb.className='lightbox';lb.innerHTML=`<img src="${$('shot').src}">`;lb.onclick=()=>lb.remove();document.body.appendChild(lb)};

function eventColor(t){
 const to=(t.split(' -> ')[1]||'').split(' ')[0];  // transitions: colour by the new state
 if(to)return {QUEUE:'gold',CHAR_SELECT:'green',IN_GAME:'green',CONNECTING:'blue',UNKNOWN:'',DISCONNECTED:'red',
  PASSWORD:'red',NO_PROCESS:'red',LOGIN:'amber',NO_WINDOW:'amber',REALM_LIST:'amber'}[to]??'';
 if(/ALARM|Disconnected|crash|Stuck|Gave up|Wrong WoW|password|DISCONNECTED|NO_PROCESS/i.test(t))return'red';
 if(/-> QUEUE|queue/i.test(t))return'gold';
 if(/CHAR_SELECT|IN_GAME|Enter|world/i.test(t))return'green';
 if(/Launch|Starting|Clicking|Relaunch|Scheduled/i.test(t))return'blue';
 if(/Command|Standby|Paused|pause|resume/i.test(t))return'amber';
 return'';
}
function prettyEvent(t){
 return t.replace(/\b([A-Z_]{4,})\b/g,m=>STATES[m]?STATES[m][0]:m==='SCHEDULED'?'Scheduled':m==='STANDBY'?'Standby':m).replace(/ -> /g,' → ').replace(/^start → /,'Started → ');
}

function chart(s){
 const svg=$('chart'),wrap=svg.parentNode,W=wrap.clientWidth,H=wrap.clientHeight;
 const pts=s.filter(x=>x.pos!=null);
 if(pts.length<2){svg.innerHTML='';chartPts=null;wrap.querySelector('.empty')||wrap.insertAdjacentHTML('beforeend','<div class="empty" style="position:absolute;inset:0">The graph appears once you are in the queue</div>');return}
 wrap.querySelector('.empty')?.remove();
 const L=48,R=12,T=10,B=26,t0=s[0].t,t1=Math.max(s[s.length-1].t,t0+60);
 const maxP=Math.max(...pts.map(x=>x.pos))*1.05||1,maxE=Math.max(1,...s.flatMap(x=>[x.bl||0,x.pace||0]))*1.1;
 const X=t=>L+(W-L-R)*(t-t0)/(t1-t0),Y=(v,m)=>T+(H-T-B)*(1-v/m);
 const css=getComputedStyle(document.documentElement),c=k=>css.getPropertyValue(k).trim();
 let g='<defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+c('--gold')+'" stop-opacity=".16"/><stop offset="1" stop-color="'+c('--gold')+'" stop-opacity="0"/></linearGradient></defs>';
 for(let i=0;i<=4;i++){const y=T+(H-T-B)*i/4;g+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="${c('--border')}"/>`;
  g+=`<text x="${L-8}" y="${y+4}" fill="${c('--text-3')}" font-size="11" text-anchor="end">${Math.round(maxP*(1-i/4)).toLocaleString()}</text>`}
 const ticks=Math.min(6,Math.max(2,Math.floor((W-L-R)/110)));
 for(let i=0;i<=ticks;i++){const t=t0+(t1-t0)*i/ticks;g+=`<text x="${X(t)}" y="${H-6}" fill="${c('--text-3')}" font-size="11" text-anchor="${i==0?'start':i==ticks?'end':'middle'}">${hm(t)}</text>`}
 const path=(arr,key,m)=>arr.filter(x=>x[key]!=null).map((x,i)=>(i?'L':'M')+X(x.t).toFixed(1)+' '+Y(x[key],m).toFixed(1)).join('');
 // One segment per queue attempt: a time gap or a jump back up means a reconnect.
 const gap=Math.max(90,4*(D&&D.interval||20)),segs=[];let cur=[];
 for(const x of s){const p=cur[cur.length-1];
  if(p&&(x.t-p.t>gap||(x.pos!=null&&p.pos!=null&&x.pos>p.pos*1.1+20))){segs.push(cur);cur=[]}
  cur.push(x)}
 if(cur.length)segs.push(cur);
 for(const seg of segs){
  const sp=seg.filter(x=>x.pos!=null);
  if(!hidden.has('pos')&&sp.length){const p=path(sp,'pos',maxP);g+=`<path d="${p}L${X(sp[sp.length-1].t)} ${H-B}L${X(sp[0].t)} ${H-B}Z" fill="url(#fill)"/><path d="${p}" fill="none" stroke="${c('--gold')}" stroke-width="2.2" stroke-linejoin="round"/>`}
  if(!hidden.has('bl'))g+=`<path d="${path(seg,'bl',maxE)}" fill="none" stroke="${c('--blue')}" stroke-width="1.6" stroke-dasharray="5 4"/>`;
  if(!hidden.has('pace'))g+=`<path d="${path(seg,'pace',maxE)}" fill="none" stroke="${c('--green')}" stroke-width="1.6" stroke-dasharray="5 4"/>`;
 }
 let lastLabel=-1e9;
 for(let i=1;i<segs.length;i++){const x=X(segs[i][0].t);g+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${H-B}" stroke="${c('--red')}" stroke-opacity=".55" stroke-dasharray="2 4"/>`;
  if(x-lastLabel>80){lastLabel=x;g+=`<text x="${x+(x>W-R-70?-5:5)}" y="${T+11}" fill="${c('--red')}" font-size="10.5" text-anchor="${x>W-R-70?'end':'start'}">reconnect</text>`}}
 g+=`<line id="hx" y1="${T}" y2="${H-B}" stroke="${c('--text-3')}" stroke-dasharray="3 3" opacity="0"/><circle id="hd" r="4.5" fill="${c('--gold')}" stroke="${c('--surface')}" stroke-width="2" opacity="0"/>`;
 svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=g;chartPts={s,X,Y,maxP,W,H};
}
$('chart').addEventListener('mousemove',e=>{
 if(!chartPts)return;const {s,X,Y,maxP,W}=chartPts,r=e.currentTarget.getBoundingClientRect(),mx=e.clientX-r.left;
 let best=s[0];for(const x of s)if(Math.abs(X(x.t)-mx)<Math.abs(X(best.t)-mx))best=x;
 const hx=$('hx'),hd=$('hd'),tip=$('tip'),px=X(best.t);
 hx.setAttribute('x1',px);hx.setAttribute('x2',px);hx.setAttribute('opacity',1);
 if(best.pos!=null){hd.setAttribute('cx',px);hd.setAttribute('cy',Y(best.pos,maxP));hd.setAttribute('opacity',1)}
 tip.innerHTML=`<div class="faint">${hm(best.t)}</div><b>#${nf(best.pos)}</b><div class="muted">Blizzard ${fm(best.bl)} · pace ${fm(best.pace)}</div>`;
 tip.style.opacity=1;tip.style.left=Math.min(Math.max(px-70,0),W-160)+'px';tip.style.top='6px';
});
$('chart').addEventListener('mouseleave',()=>{['hx','hd'].forEach(id=>$(id)?.setAttribute('opacity',0));$('tip').style.opacity=0});

function render(d){
 const active=d.mode==='active';
 $('game').textContent=d.game?('World of Warcraft · '+d.game.replace(/_/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase())):'World of Warcraft';
 let label,color;
 if(d.mode==='standby'){label='Standby';color=''}
 else if(d.mode==='scheduled'){label='Scheduled';color='blue'}
 else if(d.paused){label='Paused';color='amber'}
 else [label,color]=STATES[d.state]||['Starting',''];
 $('chip').className='chip '+color;$('chipText').textContent=label;
 $('banner').hidden=!d.alarm;$('alarmTitle').textContent=d.alarm_title||'Alarm';

 const inQueue=active&&(d.state==='QUEUE'||d.position!=null&&d.in_line);
 $('queueView').hidden=!active;$('idleView').hidden=active;
 $('etaView').hidden=!active;$('schedView').hidden=active;
 if(!active){$('schedAt').textContent=d.mode==='scheduled'?hm(d.start_at):'Not set';
  $('schedSub').textContent=d.mode==='scheduled'?'Pick another time below to change it.':'Start the queue later, so it finishes when you\'re back.'}
 if(active){
  const done=d.state==='CHAR_SELECT'||d.state==='IN_GAME';
  $('pos').textContent=done&&d.in_line!==false?'Done':d.state==='QUEUE'||d.position!=null?nf(d.position):'—';
  const sp=d.queue_start_pos,p=d.position;
  if(sp&&p!=null&&d.state==='QUEUE'){const pct=Math.max(0,Math.min(100,100*(sp-p)/sp));$('barFill').style.width=pct+'%';
   $('progress').textContent=Math.round(pct)+'% through the queue';$('startPos').textContent='started at #'+nf(sp)}
  else if(d.state==='CHAR_SELECT'||d.state==='IN_GAME'){$('barFill').style.width='100%';$('progress').textContent=d.state==='IN_GAME'?'You are in the world':'Queue finished';$('startPos').textContent=''}
  else{$('barFill').style.width='0';$('progress').textContent=STATES[d.state]?STATES[d.state][0]+'…':'Waiting for queue data';$('startPos').textContent=''}
 }else{
  $('idleLabel').textContent=d.mode==='scheduled'?'Launching in':'On standby';
  $('idleText').textContent=d.mode==='scheduled'?'WoW starts at '+hm(d.start_at)+'. Use Cancel start to call it off.':'Nothing is running. Press Start now, or type a time below, e.g. "start in 45m".';
 }
 const fin=active&&(d.state==='CHAR_SELECT'||d.state==='IN_GAME');
 $('inat').textContent=fin?'Now':(active&&d.in_at)||'—';
 $('left').textContent=d.state==='CHAR_SELECT'?'Waiting at character select':d.state==='IN_GAME'?'You are in the world':(active&&d.eta!=null)?fm(d.eta)+' left':'No estimate yet';
 $('bl').textContent=fm(d.blizzard_eta);$('pace').textContent=fm(d.pace_eta);
 $('rate').textContent=d.rate?Math.round(d.rate).toLocaleString()+' / min':'—';$('rl').textContent=d.relaunches;

 $('bStart').hidden=active;$('bCancel').hidden=d.mode!=='scheduled';$('bStandby').hidden=d.mode==='standby';
 $('bEnter').hidden=d.state!=='CHAR_SELECT'||!active;$('bRelaunch').hidden=!active;$('bPause').hidden=!active;
 $('bPause').dataset.c=d.paused?'resume':'pause';$('bPause').querySelector('span').textContent=d.paused?'Resume':'Pause';
 $('topic').textContent=d.topic||'—';
 $('thHead').textContent=d.thresholds?d.thresholds.heads_up+' min before entry':'—';
 $('thAlarm').textContent=d.thresholds?d.thresholds.alarm+' min before entry':'—';
 $('thRec').textContent=d.auto_reconnect?(d.paused?'Paused':'On'):'Off';
 $('modeText').textContent=active?(d.auto_reconnect?(d.paused?'Automation paused':'Auto-reconnect on'):'Watch only'):'';

 chart(d.samples||[]);
 const ev=(d.events||[]).slice().reverse();
 $('events').innerHTML=ev.map(e=>`<li><time>${hm(e.t)}</time><span class="mark ${eventColor(e.text)}"></span><span>${prettyEvent(e.text).replace(/</g,'&lt;')}</span></li>`).join('')||'<li class="faint">Nothing yet</li>';
 $('since').textContent='Running since '+hm(d.started);
}
function tick(){
 if(D&&D.mode==='scheduled'&&D.start_at){const s=Math.max(0,Math.round(D.start_at-Date.now()/1000+(D._skew||0)));
  $('countdown').textContent=s>=3600?Math.floor(s/3600)+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'):Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
 else if(D&&D.mode==='standby')$('countdown').textContent='Ready';
 const age=(Date.now()-lastOk)/1000;
 $('dot').classList.toggle('off',age>15);$('updated').textContent=lastOk?(age>15?'Watcher not responding':'Live · updated '+Math.round(age)+'s ago'):'Connecting…';
}
async function load(){
 try{const d=await (await fetch('/api/state',{cache:'no-store'})).json();d._skew=d.now-Date.now()/1000;D=d;lastOk=Date.now();render(d);
  if(d.state&&d.mode==='active'){$('shot').src='/shot.jpg?'+Date.now();$('shotTime').textContent=hm(d.now)}
  $('shotEmpty').hidden=!!d.has_shot;$('shotTime').hidden=!d.has_shot}
 catch(e){}
}
load();setInterval(load,4000);setInterval(tick,1000);addEventListener('resize',()=>D&&chart(D.samples||[]));
</script></body></html>"""


def lan_ip():
    """This PC's address on the home network (no traffic is actually sent)."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.168.1.1", 9))
            return s.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())


def serve(watcher, host, port, log):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/":
                self._send(200, PAGE.encode(), "text/html; charset=utf-8")
            elif path == "/api/state":
                with watcher.lock:
                    body = json.dumps(watcher.snap)
                self._send(200, body.encode(), "application/json")
            elif path == "/shot.jpg" and watcher.last_jpeg:
                self._send(200, watcher.last_jpeg, "image/jpeg")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if urlparse(self.path).path != "/api/cmd":
                return self._send(404, b"not found", "text/plain")
            n = int(self.headers.get("Content-Length") or 0)
            watcher.command(self.rfile.read(n).decode(errors="replace")[:50], "dashboard")
            self._send(200, b"ok", "text/plain")

    httpd = ThreadingHTTPServer((host, port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log.info("Dashboard: http://%s:%s", "localhost" if host in ("127.0.0.1", "0.0.0.0") else host, port)
    if host == "0.0.0.0":
        log.info("Dashboard on your phone (same Wi-Fi): http://%s:%s", lan_ip(), port)
    return httpd
