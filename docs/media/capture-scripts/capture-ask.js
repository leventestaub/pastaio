// Usage: BASE=http://localhost:8081 node capture-ask.js <pasta-photo.jpg> [shot ...]
// Web export built with PASTAIO_WEB_CAPTURE=1, real backend on :8000. One shot
// per guarantee: question, answer and the "How Pastaio answered" trace in the
// same frame. Pass shot names (scaling, fact, timer, diet, identify) to redo some.
const {newPage} = require('./lib');
const BASE = process.env.BASE || 'http://localhost:8081', OUT = 'out/';
const [photo, ...only] = process.argv.slice(2);
(async () => {
  const {b, p} = await newPage();
  const wait = (ms = 1500) => p.waitForTimeout(ms);
  const shot = async n => { await p.screenshot({path: OUT + n + '.png'}); console.log('saved', n); };
  const box = () => p.getByPlaceholder(/Ask Pastaio|Ask a follow-up/).first();
  const ask = async q => {
    if (!(await box().isVisible().catch(() => false))) { await p.getByText(/^Ask/).filter({visible: true}).last().click(); await wait(800); }
    await box().fill(q); await p.keyboard.press('Enter');
    await p.getByText('Pastaio is thinking…').waitFor({state: 'hidden', timeout: 120000});
    await wait(600);
  };
  const go = async url => { await p.goto(url); await wait(7000); };
  const done = () => p.getByText('Done', {exact: true}).click().catch(() => {});
  const run = n => only.length === 0 || only.includes(n);

  // Scaling: amounts computed in code, not by the model.
  if (run('scaling')) {
    await go(`${BASE}/recipe/rigatoni-alla-gricia`);
    await ask('Scale this for 2 people. How much rigatoni and guanciale?');
    await shot('08-ask-scaling'); await done(); await wait(800);
  }
  // Sourced fact: answered from the KB record and its sources.
  if (run('fact')) {
    await go(`${BASE}/recipe/bucatini-allamatriciana`);
    await ask('Where does amatriciana come from?');
    await shot('09-ask-sourced-fact'); await done(); await wait(800);
  }
  // Timer in cooking mode: the duration comes from the KB step (gricia step 3,
  // 600 s). The confirm phase auto-dismisses, so shoot right away.
  if (run('timer')) {
    await go(`${BASE}/recipe/rigatoni-alla-gricia`);
    await p.getByText('Start cooking', {exact: true}).click(); await wait(1500);
    for (let i = 0; i < 2; i++) { await p.getByText('Next step').click(); await wait(500); }
    await ask('Set a timer for this step.');
    await shot('10-ask-timer'); await wait(6000);
  }
  // Diet filter: vegetarian is remembered, then the search excludes what breaks it.
  if (run('diet')) {
    await go(BASE);
    await ask("I'm vegetarian.");
    await wait(9000);
    await go(BASE);
    await ask('What should I cook tonight?');
    await shot('11-ask-diet'); await done(); await wait(800);
  }
  // Shape identification with alternatives.
  if (run('identify')) {
    await go(BASE);
    await p.getByText('Identify', {exact: false}).filter({visible: true}).first().click(); await wait(2000);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Pick from library').click()]);
    await fc.setFiles(photo);
    await p.getByText('Find recipes').waitFor({timeout: 120000}); await wait(1500);
    await shot('12-identify');
  }
  await b.close();
})();
