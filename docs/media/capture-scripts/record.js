// Usage: node record.js  -> out/walkthrough.webm (splash + browse + recipe + cooking), timings logged
const {newPage}=require('./lib');
const BASE='http://localhost:8081';
(async()=>{
 const {b,c,p}=await newPage({dsf:1,ctx:{recordVideo:{dir:'vid',size:{width:390,height:844}}}});
 const wait=ms=>p.waitForTimeout(ms);
 const tab=i=>p.touchscreen.tap(390*(0.125+0.25*i),800);
 const t0=Date.now(); const mark=n=>console.log(n,((Date.now()-t0)/1000).toFixed(2));
 await p.goto(BASE); mark('goto'); await wait(6000); mark('home');
 await tab(1); await wait(1800); mark('discover');
 await p.mouse.wheel(0,0); await p.touchscreen.tap(200,615); await wait(2500); mark('recipe');
 await p.mouse.wheel(0,400); await wait(1200);
 await p.getByText('Start cooking',{exact:true}).click(); await wait(2000); mark('cooking');
 for(let i=0;i<2;i++){await p.getByText('Next step').click();await wait(1500);}
 mark('end');
 const v=p.video(); await c.close(); console.log(await v.path()); await b.close();})();
