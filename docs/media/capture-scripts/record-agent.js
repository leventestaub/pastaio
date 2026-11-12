// Usage: BASE=http://localhost:8081 node record-agent.js <pasta-photo.jpg>
// Real backend on :8000 (Groq). Records vid/*.webm and writes marks.json:
// [label, seconds] pairs; "wait:<n>"/"done:<n>" bracket model waits that
// make-gif.py speeds up.
const fs = require('fs');
const {newPage} = require('./lib');
const BASE = process.env.BASE || 'http://localhost:8081';
(async () => {
  const {b, c, p} = await newPage({dsf: 1, ctx: {recordVideo: {dir: 'vid', size: {width: 390, height: 844}}}});
  const t0 = Date.now(), marks = [];
  const mark = n => { marks.push([n, (Date.now() - t0) / 1000]); console.log(n, marks.at(-1)[1].toFixed(1)); };
  const wait = ms => p.waitForTimeout(ms);
  let asks = 0;
  const type = async (box, text) => { await box.click(); await box.pressSequentially(text, {delay: 35}); };
  const ask = async q => {
    const box = p.getByPlaceholder(/Ask Pastaio|Ask a follow-up/).first();
    if (!(await box.isVisible().catch(() => false))) { await p.getByText(/^Ask/).last().click(); await wait(700); }
    await type(p.getByPlaceholder(/Ask Pastaio|Ask a follow-up/).first(), q);
    await p.keyboard.press('Enter'); mark(`wait:${++asks}`);
    await p.getByText('Pastaio is thinking…').waitFor({state: 'hidden', timeout: 120000});
    mark(`done:${asks}`);
  };

  await p.goto(BASE); await wait(7000); mark('home');
  await wait(1500);
  await p.getByText('Identify', {exact: false}).first().click(); await wait(2000);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Pick from library').click()]);
  await fc.setFiles(process.argv[2]); mark('wait:photo');
  await p.getByText('Find recipes').waitFor({timeout: 120000}); mark('done:photo');
  await wait(2500);
  await p.getByText('Find recipes').click(); await wait(2500); mark('shape');
  await p.getByText('Rigatoni alla Gricia').first().click(); await wait(2500); mark('recipe');
  await p.mouse.wheel(0, 350); await wait(1500); await p.mouse.wheel(0, -350); await wait(800);

  await ask('Scale this for 2 people. How much rigatoni and guanciale?');
  await wait(4000);
  await p.getByText('Done', {exact: true}).click().catch(() => p.mouse.click(195, 100)); await wait(800);

  await p.mouse.wheel(0, 500); await wait(800);
  await p.getByText('Start cooking', {exact: true}).click(); await wait(2000); mark('cooking');
  for (let i = 0; i < 2; i++) { await p.getByText('Next step').click(); await wait(1200); }

  await ask('How do I know the guanciale is done?');
  await wait(4500);
  await ask('Set a timer for that.');
  await wait(3500); mark('timer');
  await wait(2500);
  mark('end');
  fs.writeFileSync('marks.json', JSON.stringify(marks));
  const v = p.video(); await c.close(); console.log(await v.path()); await b.close();
})();
