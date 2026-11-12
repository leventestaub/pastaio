// Usage: BASE=http://localhost:8081 node capture.js  (web build, real backend on :8000)
const {newPage}=require('./lib');
const BASE=process.env.BASE||'http://localhost:8081', OUT='out/';
(async()=>{
 const {b,c,p}=await newPage();
 const wait=(ms=1500)=>p.waitForTimeout(ms);
 const shot=async n=>{await wait();await p.screenshot({path:OUT+n+'.png'});console.log('saved',n)};
 const tab=i=>p.touchscreen.tap(390*(0.125+0.25*i),800);
 // bookmark a few recipes so the cookbook is not empty
 for(const id of ['bucatini-allamatriciana','trofie-al-pesto','spaghetti-alla-carbonara']){
   await p.goto(`${BASE}/recipe/${id}`); await wait(3500); await p.touchscreen.tap(365,16); await wait(600);
 }
 await p.goto(BASE); await wait(5000);
 await shot('01-home');
 await tab(1); await shot('02-discover');
 await p.goto(`${BASE}/recipe/bucatini-allamatriciana`); await wait(3500); await shot('03-recipe-detail');
 await p.getByText('Start cooking',{exact:true}).click(); await wait(1500);
 for(let i=0;i<3;i++){await p.getByText('Next step').click();await wait(400);}
 await shot('04-cooking-step');
 await p.goto(`${BASE}/cookbook`); await wait(4000); await shot('05-cookbook');
 await tab(3); await shot('07-memory');
 await p.goto(`${BASE}/recipe/trofie-al-pesto`); await wait(3500);
 await p.getByText('Start cooking',{exact:true}).click(); await wait(1500);
 await p.touchscreen.tap(340,25); await wait(1200);
 await p.screenshot({path:OUT+'06a-ask-pastaio-open.png'});
 await p.fill('input,textarea','For 2 people: how much trofie and basil?'); await p.keyboard.press('Enter');
 await p.getByText('Pastaio is thinking…').waitFor({state:'hidden',timeout:120000}); await wait(1500);
 await p.screenshot({path:OUT+'06b-ask-pastaio-reply.png'});
 await b.close();})();
