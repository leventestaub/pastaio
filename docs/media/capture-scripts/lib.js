const { chromium } = require('playwright');
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
exports.newPage = async (opts={}) => {
  const b=await chromium.launch();
  const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:opts.dsf||2,isMobile:true,hasTouch:true,...(opts.ctx||{})});
  const p=await c.newPage();
  // Backend has no CORS middleware; proxy :8000 through node and add headers (no backend change).
  await p.route('http://localhost:8000/**', async route=>{
    const r=route.request();
    if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:CORS});
    const res=await fetch(r.url(),{method:r.method(),headers:r.headers(),body:r.postData()});
    const buf=Buffer.from(await res.arrayBuffer()); if(process.env.DBG)console.log('RESP',res.status,buf.toString().slice(0,600)); route.fulfill({status:res.status,headers:{...CORS,'content-type':res.headers.get('content-type')||'application/json'},body:buf});
  });
  await p.addInitScript(()=>{const s=document.createElement('style');s.textContent='*{outline:none !important}';document.addEventListener('DOMContentLoaded',()=>document.head.appendChild(s));});
  return {b,c,p};
};
