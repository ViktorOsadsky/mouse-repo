let results;
let schema;
let previousPrediction = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = (value, digits = 2) => Number(value).toFixed(digits);

function showError(message) {
  const box = $('#form-error');
  box.textContent = message || '';
  box.hidden = !message;
}

function showState(name) {
  for (const state of ['empty', 'loading', 'ready']) $(`#prediction-${state}`).hidden = state !== name;
}

function download(name, contents, type = 'text/csv') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([contents], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function parseCSV(text) {
  const rows = [], row = [];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); if (row.some(v => v.trim())) rows.push([...row]); row.length = 0; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function identity() {
  const sex = $('#sex').value, line = $('#line').value;
  if (!sex || !line) throw new Error('Choose the mouseâ€™s sex and line.');
  return { sex, line };
}

async function submitPrediction(payload, button) {
  showError('');
  const oldText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'Estimatingâ€¦';
  showState('loading');
  const started = performance.now();
  try {
    const response = await fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The prediction request failed.');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 650 - (performance.now() - started))));
    $('#predicted-age').textContent = number(data.predicted_age_months);
    const mae = data.model === 'full' ? results.full_model.mae_months : results.behavior_model.mae_months;
    $('#prediction-meta').textContent = `${data.model === 'full' ? 'Plasma + behavior' : 'Behavior'} model Â· ${data.input_measures} measures${data.matched_proteins ? ` Â· ${data.matched_proteins} proteins` : ''} Â· test MAE ${number(mae)} months.`;
    const change = $('#prediction-change');
    if (previousPrediction && previousPrediction.model === data.model) {
      const delta = data.predicted_age_months - previousPrediction.age;
      change.textContent = Math.abs(delta) >= .005 ? `Change from previous estimate: ${delta > 0 ? '+' : ''}${number(delta)} months` : 'Displayed estimate is unchanged; this edit is smaller than the modelâ€™s displayed resolution.';
      change.hidden = false;
    } else change.hidden = true;
    previousPrediction = { model: data.model, age: data.predicted_age_months };
    showState('ready');
  } catch (error) {
    showError(error.message || 'Prediction failed. Please try again.');
    showState(previousPrediction ? 'ready' : 'empty');
  } finally {
    button.disabled = false;
    button.innerHTML = oldText;
  }
}

function setupForm() {
  for (const line of schema.lines) {
    const option = document.createElement('option');
    option.value = line;
    option.textContent = line;
    $('#line').appendChild(option);
  }
  const tabs = [$('#tab-behavior'), $('#tab-full')];
  tabs.forEach((tab, index) => tab.addEventListener('click', () => {
    tabs.forEach((item, i) => {
      const active = i === index;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      $(`#panel-${i ? 'full' : 'behavior'}`).hidden = !active;
    });
    showError('');
  }));
  $('#behavior-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const subject = identity(), behavior = {};
      for (const input of $$('#behavior-form input')) if (input.value.trim()) behavior[input.name] = Number(input.value);
      if (Object.keys(behavior).length < 4) throw new Error('Enter at least four measurements.');
      submitPrediction({ ...subject, mode: 'behavior', behavior }, event.submitter || $('#behavior-form button[type=submit]'));
    } catch (error) { showError(error.message); }
  });
  for (const [file, label] of [['#behavior-file', '#behavior-file-name'], ['#plasma-file', '#plasma-file-name']]) {
    $(file).addEventListener('change', (event) => { $(label).textContent = event.target.files[0]?.name || 'Select file'; });
  }
  $('#full-submit').addEventListener('click', async (event) => {
    try {
      const subject = identity();
      const behaviorFile = $('#behavior-file').files[0], plasmaFile = $('#plasma-file').files[0];
      if (!behaviorFile || !plasmaFile) throw new Error('Upload both CSV files.');
      const [behaviorRows, plasmaRows] = await Promise.all([behaviorFile.text(), plasmaFile.text()]).then(texts => texts.map(parseCSV));
      if (behaviorRows.length < 2 || plasmaRows.length < 2) throw new Error('Both CSV files need headers and data.');
      const headers = behaviorRows[0].map(v => v.replace(/^\uFEFF/, '').trim()), behavior = {};
      headers.forEach((name, i) => { if (schema.behavior_measures.includes(name) && behaviorRows[1][i]?.trim()) behavior[name] = Number(behaviorRows[1][i]); });
      if (Object.keys(behavior).length < 5) throw new Error('At least five behavior measures must match the template.');
      const plasmaHeaders = plasmaRows[0].map(v => v.replace(/^\uFEFF/, '').trim().toLowerCase());
      const accession = plasmaHeaders.findIndex(v => ['pg.proteinaccessions', 'protein', 'protein_accession'].includes(v));
      const quantity = plasmaHeaders.findIndex(v => ['pg.quantity', 'quantity'].includes(v));
      if (accession < 0 || quantity < 0) throw new Error('Plasma CSV needs PG.ProteinAccessions and PG.Quantity columns.');
      const grouped = {};
      for (const row of plasmaRows.slice(1)) {
        const name = row[accession]?.trim(), value = Number(row[quantity]);
        if (name && Number.isFinite(value) && value > 0) (grouped[name] ||= []).push(value);
      }
      const plasma = {};
      for (const [name, values] of Object.entries(grouped)) {
        values.sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        plasma[name] = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      }
      await submitPrediction({ ...subject, mode: 'full', behavior, plasma }, event.currentTarget);
    } catch (error) { showError(error.message); }
  });
  $('#behavior-template').addEventListener('click', () => download('mouse_behavior_template.csv', schema.behavior_measures.join(',') + '\n'));
  $('#plasma-template').addEventListener('click', () => download('mouse_plasma_template.csv', 'PG.ProteinAccessions,PG.Quantity\n'));
}

async function init() {
  try {
    [results, schema] = await Promise.all(['/data/results.json', '/data/schema.json'].map(url => fetch(url).then(response => { if (!response.ok) throw new Error('Could not load site data.'); return response.json(); })));
    $('#full-mae').textContent = number(results.full_model.mae_months);
    $('#estimator-mae').textContent = number(results.full_model.mae_months);
    setupForm();
  } catch (error) {
    showError('Estimator setup could not be loaded. Refresh the page.');
  }
}

init();
