let results;
let schema;
let selectedModel = 'full';
let previousPrediction = null;
let activeTooltipMark = null;
let tooltipPinned = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = (value, digits = 2) => Number(value).toFixed(digits);

function svg(content, width, height, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${content}</svg>`;
}

function chartTooltip() {
  let tooltip = $('#chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function hideChartTooltip(force = false) {
  if (tooltipPinned && !force) return;
  chartTooltip().hidden = true;
  activeTooltipMark = null;
  tooltipPinned = false;
}

function showChartTooltip(mark, selected, pin = false) {
  const tooltip = chartTooltip();
  tooltip.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = selected.title;
  tooltip.appendChild(heading);
  const list = document.createElement('dl');
  for (const [name, value] of selected.fields) {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = name;
    const result = document.createElement('dd');
    result.textContent = value;
    item.append(term, result);
    list.appendChild(item);
  }
  tooltip.appendChild(list);
  tooltipPinned = pin;
  activeTooltipMark = mark;
  tooltip.hidden = false;
  const markRect = mark.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const left = Math.max(12, Math.min(window.innerWidth - tipRect.width - 12, markRect.left + markRect.width / 2 - tipRect.width / 2));
  const below = markRect.bottom + 12;
  const top = below + tipRect.height <= window.innerHeight - 12 ? below : Math.max(12, markRect.top - tipRect.height - 12);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function attachDetails(chartId, descriptions) {
  $$(`${chartId} [data-info]`).forEach((mark) => {
    const selected = descriptions[Number(mark.dataset.info)];
    mark.setAttribute('aria-describedby', 'chart-tooltip');
    mark.addEventListener('mouseenter', () => showChartTooltip(mark, selected));
    mark.addEventListener('mouseleave', () => { if (activeTooltipMark === mark) hideChartTooltip(); });
    mark.addEventListener('focus', () => showChartTooltip(mark, selected));
    mark.addEventListener('blur', () => { if (activeTooltipMark === mark) hideChartTooltip(); });
    mark.addEventListener('click', () => showChartTooltip(mark, selected, true));
    mark.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showChartTooltip(mark, selected, true);
      }
    });
  });
}

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('[data-info]')) hideChartTooltip(true);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideChartTooltip(true);
});
window.addEventListener('scroll', () => hideChartTooltip(true), {passive: true});
window.addEventListener('resize', () => hideChartTooltip(true));

function drawPredictionChart() {
  hideChartTooltip(true);
  const groups = results.age_groups.filter((group) => group.test && group[`${selectedModel}_mean`] !== null);
  const W = 920, H = 300, L = 42, R = 18, T = 15, B = 31, MAX = 36;
  const x = (value) => L + (value / MAX) * (W - L - R);
  const y = (value) => H - B - (value / MAX) * (H - T - B);
  let content = '';
  for (const tick of [0, 6, 12, 18, 24, 30, 36]) {
    content += `<line x1="${L}" x2="${W-R}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e7eee8"/>`;
    content += `<text x="${L-9}" y="${y(tick)+4}" text-anchor="end" fill="#81968a" font-size="10">${tick}</text>`;
    content += `<text x="${x(tick)}" y="${H-7}" text-anchor="middle" fill="#81968a" font-size="10">${tick}</text>`;
  }
  content += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(36)}" y2="${y(36)}" stroke="#9ab7a5" stroke-dasharray="5 5"/>`;
  const color = selectedModel === 'full' ? '#357e79' : '#d28560';
  const descriptions = [];
  groups.forEach((group, index) => {
    const mean = group[`${selectedModel}_mean`];
    descriptions.push({title: `${number(group.age, 0)} months at measurement`, fields: [
      ['Test samples / mice', `${group.test} / ${group.test_mice}`],
      ['Mean predicted age', `${number(mean)} months`],
      ['Prediction SD', `${number(group[`${selectedModel}_sd`])} months`],
      ['Mean bias', `${group[`${selectedModel}_bias`] >= 0 ? '+' : ''}${number(group[`${selectedModel}_bias`])} months`],
      ['MAE', `${number(group[`${selectedModel}_mae`])} months`],
    ]});
    const spread = group[`${selectedModel}_sd`];
    if (spread !== null) content += `<line x1="${x(group.age)}" x2="${x(group.age)}" y1="${y(Math.min(MAX, mean + spread))}" y2="${y(Math.max(0, mean - spread))}" stroke="${color}" stroke-width="2"/><line x1="${x(group.age)-6}" x2="${x(group.age)+6}" y1="${y(Math.min(MAX, mean + spread))}" y2="${y(Math.min(MAX, mean + spread))}" stroke="${color}"/><line x1="${x(group.age)-6}" x2="${x(group.age)+6}" y1="${y(Math.max(0, mean - spread))}" y2="${y(Math.max(0, mean - spread))}" stroke="${color}"/>`;
    content += `<circle data-info="${index}" tabindex="0" cx="${x(group.age)}" cy="${y(mean)}" r="7" fill="${color}" stroke="white" stroke-width="2" aria-label="${number(group.age, 0)}-month group, ${group.test} test samples"/>`;
  });
  $('#prediction-chart').innerHTML = svg(content, W, H, 'Mean predicted age versus recorded age, grouped by age');
  attachDetails('#prediction-chart', descriptions);
}

function drawAgeChart() {
  const groups = results.age_groups;
  const W = 520, H = 220, L = 35, R = 9, T = 10, B = 30;
  const max = Math.ceil(Math.max(...groups.map(g => g.matched)) / 25) * 25;
  const step = (W - L - R) / groups.length;
  const descriptions = [];
  let content = '';
  for (const tick of [0, max / 2, max]) {
    const yy = H - B - (tick / max) * (H - T - B);
    content += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e7eee8"/><text x="${L-6}" y="${yy+4}" text-anchor="end" fill="#84958b" font-size="9">${Math.round(tick)}</text>`;
  }
  groups.forEach((group, index) => {
    const bar = Math.max(1, (group.matched / max) * (H - T - B));
    const xx = L + index * step + step * .17;
    content += `<rect data-info="${index}" tabindex="0" x="${xx}" y="${H-B-bar}" width="${step*.66}" height="${bar}" rx="2" fill="#58958b" aria-label="${number(group.age, 0)} months, ${group.matched} matched samples"/>`;
    content += `<text x="${xx+step*.33}" y="${H-8}" text-anchor="middle" fill="#819187" font-size="9">${number(group.age, 0)}</text>`;
    descriptions.push({title: `${number(group.age, 0)} months at measurement`, fields: [
      ['Matched samples / mice', `${group.matched} / ${group.matched_mice}`],
      ['Female / male samples', `${group.female} / ${group.male}`],
      ['Held-out samples / mice', `${group.test} / ${group.test_mice}`],
    ]});
  });
  $('#age-chart').innerHTML = svg(content, W, H, 'Number of matched samples at each recorded age');
  attachDetails('#age-chart', descriptions);
}

function drawErrorChart() {
  const groups = results.age_groups.filter(g => g.test && g.full_mae !== null && g.behavior_mae !== null);
  const W = 520, H = 220, L = 35, R = 9, T = 10, B = 30, max = Math.max(8, Math.ceil(Math.max(...groups.flatMap(g => [g.full_mae, g.behavior_mae])) / 2) * 2);
  const step = (W - L - R) / groups.length;
  const descriptions = [];
  let content = '';
  for (const tick of [0, max / 2, max]) {
    const yy = H - B - (tick / max) * (H - T - B);
    content += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e7eee8"/><text x="${L-6}" y="${yy+4}" text-anchor="end" fill="#84958b" font-size="9">${number(tick, 0)}</text>`;
  }
  groups.forEach((group, index) => {
    const xx = L + index * step, width = step * .30;
    for (const [offset, value, color] of [[.16, group.full_mae, '#357e79'], [.51, group.behavior_mae, '#d28560']]) {
      const bar = (value / max) * (H - T - B);
      content += `<rect data-info="${index}" tabindex="0" x="${xx+step*offset}" y="${H-B-bar}" width="${width}" height="${bar}" rx="2" fill="${color}" aria-label="${number(group.age, 0)} months, mean absolute error ${number(value)} months"/>`;
    }
    content += `<text x="${xx+step*.5}" y="${H-8}" text-anchor="middle" fill="#819187" font-size="9">${number(group.age, 0)}</text>`;
    descriptions.push({title: `${number(group.age, 0)} months at measurement`, fields: [
      ['Test samples / mice', `${group.test} / ${group.test_mice}`],
      ['Plasma + phenotype MAE', `${number(group.full_mae)} months`],
      ['Phenotype-only MAE', `${number(group.behavior_mae)} months`],
      ['Plasma + phenotype bias', `${group.full_bias >= 0 ? '+' : ''}${number(group.full_bias)} months`],
      ['Phenotype-only bias', `${group.behavior_bias >= 0 ? '+' : ''}${number(group.behavior_bias)} months`],
    ]});
  });
  $('#error-chart').innerHTML = svg(content, W, H, 'Average absolute error by recorded age group for both models');
  attachDetails('#error-chart', descriptions);
}

function drawBatchChart() {
  const groups = results.batch_groups;
  const W = 520, H = 220, L = 35, R = 9, T = 10, B = 30, max = Math.ceil(Math.max(...groups.map(g => g.matched)) / 50) * 50;
  const step = (W - L - R) / groups.length;
  const descriptions = [];
  let content = '';
  for (const tick of [0, max / 2, max]) {
    const yy = H - B - (tick / max) * (H - T - B);
    content += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e7eee8"/><text x="${L-6}" y="${yy+4}" text-anchor="end" fill="#84958b" font-size="9">${number(tick, 0)}</text>`;
  }
  groups.forEach((group, index) => {
    const bar = (group.matched / max) * (H - T - B), xx = L + index * step + step * .2;
    content += `<rect data-info="${index}" tabindex="0" x="${xx}" y="${H-B-bar}" width="${step*.6}" height="${bar}" rx="2" fill="#c58e71" aria-label="Batch ${group.batch}, ${group.matched} matched samples"/>`;
    content += `<text x="${xx+step*.3}" y="${H-8}" text-anchor="middle" fill="#819187" font-size="10">${group.batch}</text>`;
    descriptions.push({title: `Plasma batch ${group.batch}`, fields: [
      ['Matched samples / mice', `${group.matched} / ${group.matched_mice}`],
      ['Held-out samples', String(group.test)],
      ['Median age', `${number(group.median_age, 0)} months`],
      ['Median proteins detected', `${number(group.median_detected_protein_pct, 1)}%`],
      ['Plasma + phenotype MAE', `${number(group.full_mae)} months`],
    ]});
  });
  $('#batch-chart').innerHTML = svg(content, W, H, 'Number of matched samples by plasma batch');
  attachDetails('#batch-chart', descriptions);
}

function drawSexChart() {
  const groups = results.sex_groups;
  const total = groups.reduce((sum, group) => sum + group.matched, 0);
  const W = 520, H = 220, L = 75, R = 25;
  let content = '';
  const descriptions = [];
  groups.forEach((group, index) => {
    const y = 40 + index * 75;
    const percentage = group.matched / total * 100;
    content += `<text x="${L-12}" y="${y+22}" text-anchor="end" fill="#536d63" font-size="13" font-weight="700">${group.sex}</text>`;
    content += `<rect x="${L}" y="${y}" width="${W-L-R}" height="32" rx="3" fill="#eef3ed"/>`;
    content += `<rect data-info="${index}" tabindex="0" x="${L}" y="${y}" width="${(W-L-R)*group.matched/total}" height="32" rx="3" fill="${index ? '#d28560' : '#58958b'}" aria-label="${group.sex}, ${group.matched} matched samples"/>`;
    content += `<text x="${W-R}" y="${y+22}" text-anchor="end" fill="#233c39" font-size="11" font-weight="700">${number(percentage, 1)}%</text>`;
    descriptions.push({title: group.sex, fields: [
      ['Matched samples / mice', `${group.matched} / ${group.matched_mice}`],
      ['Share of cohort', `${number(percentage, 1)}%`],
      ['Held-out samples', String(group.test)],
      ['Median age', `${number(group.median_age, 0)} months`],
    ]});
  });
  $('#sex-chart').innerHTML = svg(content, W, H, 'Matched sample counts by sex');
  attachDetails('#sex-chart', descriptions);
}

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
  if (!sex || !line) throw new Error('Choose the mouse’s sex and line.');
  return { sex, line };
}

async function submitPrediction(payload, button) {
  showError('');
  const oldText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'Estimating…';
  showState('loading');
  const started = performance.now();
  try {
    const response = await fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The prediction request failed.');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 650 - (performance.now() - started))));
    $('#predicted-age').textContent = number(data.predicted_age_months);
    const mae = data.model === 'full' ? results.full_model.mae_months : results.behavior_model.mae_months;
    $('#prediction-meta').textContent = `${data.model === 'full' ? 'Plasma + behavior' : 'Behavior'} model · ${data.input_measures} measures${data.matched_proteins ? ` · ${data.matched_proteins} proteins` : ''} · test MAE ${number(mae)} months.`;
    const change = $('#prediction-change');
    if (previousPrediction && previousPrediction.model === data.model) {
      const delta = data.predicted_age_months - previousPrediction.age;
      change.textContent = Math.abs(delta) >= .005 ? `Change from previous estimate: ${delta > 0 ? '+' : ''}${number(delta)} months` : 'Displayed estimate is unchanged; this edit is smaller than the model’s displayed resolution.';
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
    $('#full-r2').textContent = number(results.full_model.r2, 3);
    $('#full-rmse').textContent = number(results.full_model.rmse_months);
    $('#behavior-mae').textContent = number(results.behavior_model.mae_months);
    $('#behavior-r2').textContent = number(results.behavior_model.r2, 3);
    $('#behavior-rmse').textContent = number(results.behavior_model.rmse_months);
    $('#baseline-mae').textContent = number(results.baseline.mae_months);
    $('#comparison-note').textContent = `Plasma + phenotype MAE: ${number(results.full_model.mae_ci95[0])}–${number(results.full_model.mae_ci95[1])} months (95% bootstrap interval). Its ${number(results.mae_advantage_months)}-month advantage over phenotype only has a 95% interval of ${number(results.mae_advantage_ci95[0])} to ${number(results.mae_advantage_ci95[1])} months.`;
    drawPredictionChart(); drawAgeChart(); drawErrorChart(); drawBatchChart(); drawSexChart(); setupForm();
    $$('[data-pred-model]').forEach(button => button.addEventListener('click', () => {
      selectedModel = button.dataset.predModel;
      $$('[data-pred-model]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
      drawPredictionChart();
    }));
    $$('[data-download-chart]').forEach(button => button.addEventListener('click', () => {
      const chart = $(`#${button.dataset.downloadChart} svg`);
      if (chart) download(`${button.dataset.downloadChart}.svg`, new XMLSerializer().serializeToString(chart), 'image/svg+xml');
    }));
  } catch (error) {
    $('#prediction-chart').textContent = 'Charts could not be loaded.';
    showError('Estimator setup could not be loaded. Refresh the page.');
  }
}

init();
