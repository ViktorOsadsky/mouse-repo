(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const colors = ['#a63845', '#247b78', '#cb8058', '#586ea0', '#876794', '#8b9850', '#b46b82', '#498d67', '#936c4c'];
  let explorer;
  let activeLines = new Set();
  let chosenProtein = 'P08226';
  let activePoint = null;
  let pinned = false;
  let activeProteinData = null;
  let plotRequest = 0;
  const shardCache = new Map();
  const pendingShards = new Map();

  async function loadProteinPoints(protein) {
    let shard = shardCache.get(protein.shard);
    if (!shard) {
      if (!pendingShards.has(protein.shard)) {
        const request = fetch(`/data/proteins/${protein.shard}`).then(response => {
          if (!response.ok) throw new Error(`Could not load ${protein.shard}`);
          return response.json();
        }).then(data => {
          shardCache.set(protein.shard, data);
          if (shardCache.size > 3) shardCache.delete(shardCache.keys().next().value);
          return data;
        }).finally(() => pendingShards.delete(protein.shard));
        pendingShards.set(protein.shard, request);
      }
      shard = await pendingShards.get(protein.shard);
    }
    return (shard[protein.accession] || []).map(([sampleIndex, value]) => {
      const [mouseId, age, line, batch] = explorer.samples[sampleIndex];
      return [age, line, value, mouseId, batch];
    });
  }

  function showTab(name, updateHash = true) {
    const selected = ['dataset', 'plot', 'estimator'].includes(name) ? name : 'dataset';
    $$('[data-site-tab]').forEach(tab => {
      const isActive = tab.dataset.siteTab === selected;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      $(`#${tab.dataset.siteTab}-panel`).hidden = !isActive;
    });
    if (updateHash) history.replaceState(null, '', `#${selected}`);
    if (selected === 'plot') requestAnimationFrame(drawPlot);
    window.scrollTo({top: 0, behavior: 'auto'});
  }

  function setupTabs() {
    $$('[data-site-tab], [data-go-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.siteTab || button.dataset.goTab)));
    $('.wordmark').addEventListener('click', event => { event.preventDefault(); showTab('dataset'); });
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));
    showTab(location.hash === '#predict' ? 'estimator' : location.hash.slice(1), false);
  }

  function drawOverview(groups) {
    const width = 650, height = 260, left = 35, right = 15, top = 18, bottom = 40;
    const maximum = Math.ceil(Math.max(...groups.map(group => group.matched)) / 25) * 25;
    const step = (width - left - right) / groups.length;
    let content = '';
    for (const tick of [0, maximum / 2, maximum]) {
      const y = height - bottom - tick / maximum * (height - top - bottom);
      content += `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" stroke="#e4e5e0"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" fill="#75807b" font-size="11">${Math.round(tick)}</text>`;
    }
    groups.forEach((group, index) => {
      const bar = group.matched / maximum * (height - top - bottom);
      const x = left + index * step + step * .17;
      content += `<rect x="${x}" y="${height - bottom - bar}" width="${step * .66}" height="${bar}" fill="#618f84"><title>${group.age} months: ${group.matched} measurements</title></rect>`;
      content += `<text x="${x + step * .33}" y="${height - 12}" text-anchor="middle" fill="#56635d" font-size="11">${group.age}</text>`;
    });
    $('#overview-age-chart').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Measurements by age">${content}</svg>`;
  }

  function buildProteinOptions(filter = '') {
    const select = $('#protein-select');
    const matches = explorer.proteins.filter(protein => `${protein.gene} ${protein.accession} ${protein.description}`.toLowerCase().includes(filter.toLowerCase()));
    select.replaceChildren();
    for (const protein of matches) {
      const option = document.createElement('option');
      option.value = protein.accession;
      option.textContent = `${protein.gene} · ${protein.accession}`;
      select.appendChild(option);
    }
    if (!matches.some(protein => protein.accession === chosenProtein)) chosenProtein = matches[0]?.accession || '';
    select.value = chosenProtein;
    select.disabled = !matches.length;
    drawPlot();
  }

  function buildLineOptions() {
    const container = $('#line-options');
    explorer.lines.forEach((line, index) => {
      const label = document.createElement('label');
      label.className = 'line-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(index);
      input.checked = true;
      input.addEventListener('change', () => {
        if (input.checked) activeLines.add(index);
        else activeLines.delete(index);
        drawPlot();
      });
      const dot = document.createElement('i');
      dot.style.background = colors[index % colors.length];
      const text = document.createElement('span');
      text.textContent = line;
      label.append(input, dot, text);
      container.appendChild(label);
      activeLines.add(index);
    });
    $('#select-all-lines').addEventListener('click', () => setAllLines(true));
    $('#clear-lines').addEventListener('click', () => setAllLines(false));
  }

  function setAllLines(checked) {
    activeLines = new Set(checked ? explorer.lines.map((_, index) => index) : []);
    $$('#line-options input').forEach(input => { input.checked = checked; });
    drawPlot();
  }

  function regression(points) {
    const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point[2], 0) / points.length;
    const denominator = points.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0);
    const slope = denominator ? points.reduce((sum, point) => sum + (point[0] - meanX) * (point[2] - meanY), 0) / denominator : 0;
    return {slope, intercept: meanY - slope * meanX};
  }

  function tooltip() {
    let node = $('#point-tooltip');
    if (!node) {
      node = document.createElement('div');
      node.id = 'point-tooltip';
      node.className = 'point-tooltip';
      node.setAttribute('role', 'tooltip');
      node.hidden = true;
      document.body.appendChild(node);
    }
    return node;
  }

  function hideTooltip(force = false) {
    if (pinned && !force) return;
    tooltip().hidden = true;
    activePoint = null;
    pinned = false;
  }

  function showTooltip(mark, point, pin = false) {
    const node = tooltip();
    node.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = explorer.lines[point[1]];
    const age = document.createElement('span');
    age.textContent = `Age ${point[0]} months`;
    const signal = document.createElement('b');
    signal.textContent = `Protein signal ${point[2].toFixed(2)}`;
    const mouse = document.createElement('span');
    mouse.textContent = `Mouse ${point[3]} · batch ${point[4]}`;
    node.append(title, age, signal, mouse);
    node.hidden = false;
    activePoint = mark;
    pinned = pin;
    const pointBox = mark.getBoundingClientRect();
    const tipBox = node.getBoundingClientRect();
    node.style.left = `${Math.max(10, Math.min(innerWidth - tipBox.width - 10, pointBox.left + pointBox.width / 2 - tipBox.width / 2))}px`;
    node.style.top = `${pointBox.bottom + tipBox.height + 12 < innerHeight ? pointBox.bottom + 10 : Math.max(10, pointBox.top - tipBox.height - 10)}px`;
  }

  function attachPointEvents(points) {
    $$('#scatter-plot [data-point]').forEach(mark => {
      const point = points[Number(mark.dataset.point)];
      mark.setAttribute('aria-describedby', 'point-tooltip');
      mark.addEventListener('mouseenter', () => showTooltip(mark, point));
      mark.addEventListener('mouseleave', () => { if (activePoint === mark) hideTooltip(); });
      mark.addEventListener('focus', () => showTooltip(mark, point));
      mark.addEventListener('blur', () => { if (activePoint === mark) hideTooltip(); });
      mark.addEventListener('click', () => showTooltip(mark, point, true));
      mark.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showTooltip(mark, point, true);
        }
      });
    });
  }

  async function drawPlot() {
    if (!explorer) return;
    const currentRequest = ++plotRequest;
    hideTooltip(true);
    const protein = explorer.proteins.find(item => item.accession === chosenProtein);
    const title = $('#plot-title');
    if (!protein) {
      title.textContent = 'No matching protein';
      $('#plot-description').textContent = 'Try another search term.';
      $('#scatter-plot').replaceChildren();
      $('#plot-count').textContent = '0 measurements';
      $('#plot-trend').textContent = '';
      for (const id of ['summary-measurements', 'summary-lines', 'summary-age', 'summary-signal', 'summary-slope']) $(`#${id}`).textContent = '—';
      return;
    }
    title.textContent = `${protein.gene} · ${protein.accession}`;
    $('#plot-description').textContent = protein.description;
    if (!activeProteinData || activeProteinData.accession !== protein.accession) {
      $('#scatter-plot').innerHTML = '<p class="plot-empty">Loading protein measurements…</p>';
      try {
        const loadedPoints = await loadProteinPoints(protein);
        if (currentRequest !== plotRequest) return;
        activeProteinData = {accession: protein.accession, points: loadedPoints};
      } catch (error) {
        if (currentRequest !== plotRequest) return;
        $('#scatter-plot').innerHTML = '<p class="plot-empty">This protein could not be loaded. Try again.</p>';
        return;
      }
    }
    const minimumSelectedAge = Number($('#minimum-age').value);
    const maximumSelectedAge = Number($('#maximum-age').value);
    const points = activeProteinData.points.filter(point => activeLines.has(point[1]) && point[0] >= minimumSelectedAge && point[0] <= maximumSelectedAge);
    const fittedTrend = points.length > 2 ? regression(points) : null;
    $('#summary-measurements').textContent = points.length.toLocaleString();
    $('#summary-lines').textContent = String(new Set(points.map(point => point[1])).size);
    $('#summary-age').textContent = points.length ? `${Math.min(...points.map(point => point[0]))}–${Math.max(...points.map(point => point[0]))} months` : '—';
    $('#summary-signal').textContent = points.length ? (points.reduce((sum, point) => sum + point[2], 0) / points.length).toFixed(2) : '—';
    $('#summary-slope').textContent = fittedTrend ? `${fittedTrend.slope >= 0 ? '+' : ''}${fittedTrend.slope.toFixed(3)}` : '—';
    $('#plot-count').textContent = `${points.length.toLocaleString()} measurements · ${activeLines.size} mouse ${activeLines.size === 1 ? 'type' : 'types'}`;
    const legend = $('#plot-legend');
    legend.replaceChildren();
    explorer.lines.forEach((line, index) => {
      if (!activeLines.has(index)) return;
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = colors[index % colors.length];
      item.append(dot, document.createTextNode(line));
      legend.appendChild(item);
    });
    if (!points.length) {
      $('#scatter-plot').innerHTML = '<p class="plot-empty">No measurements match these options.</p>';
      $('#plot-trend').textContent = '';
      return;
    }

    const width = 900, height = 510, left = 70, right = 22, top = 26, bottom = 58;
    const ages = points.map(point => point[0]);
    const minimumAge = Math.min(...ages), maximumAge = Math.max(...ages);
    const values = points.map(point => point[2]);
    let minimum = Math.min(...values), maximum = Math.max(...values);
    const padding = Math.max((maximum - minimum) * .09, .25);
    minimum -= padding; maximum += padding;
    const x = age => left + (age - 2) / 29 * (width - left - right);
    const y = value => height - bottom - (value - minimum) / (maximum - minimum) * (height - top - bottom);
    let content = '';
    for (let i = 0; i <= 4; i++) {
      const tick = minimum + i * (maximum - minimum) / 4;
      const yy = y(tick);
      content += `<line x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}" stroke="#e8e9e5"/><text x="${left - 10}" y="${yy + 4}" text-anchor="end" fill="#6d7873" font-size="11">${tick.toFixed(1)}</text>`;
    }
    for (const age of [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]) {
      content += `<text x="${x(age)}" y="${height - 28}" text-anchor="middle" fill="#66716d" font-size="11">${age}</text>`;
    }
    content += `<text x="${(left + width - right) / 2}" y="${height - 4}" text-anchor="middle" fill="#394b46" font-size="12">Age (months)</text>`;
    content += `<text transform="translate(18 ${height / 2}) rotate(-90)" text-anchor="middle" fill="#394b46" font-size="12">Normalized protein signal</text>`;
    points.forEach((point, index) => {
      const jitter = (((index * 73) % 29) / 29 - .5) * .62;
      content += `<circle data-point="${index}" tabindex="0" cx="${x(point[0] + jitter)}" cy="${y(point[2])}" r="4" fill="${colors[point[1] % colors.length]}" fill-opacity=".67" stroke="#fff" stroke-width=".65" aria-label="${explorer.lines[point[1]]}, age ${point[0]} months, signal ${point[2].toFixed(2)}"/>`;
    });
    if ($('#trend-toggle').checked && points.length > 2) {
      const fit = fittedTrend;
      const start = Math.max(3, minimumAge), end = Math.min(30, maximumAge);
      content += `<line x1="${x(start)}" y1="${y(fit.intercept + fit.slope * start)}" x2="${x(end)}" y2="${y(fit.intercept + fit.slope * end)}" stroke="#3979d9" stroke-width="3" pointer-events="none"/>`;
      $('#plot-trend').textContent = `Linear trend: ${fit.slope >= 0 ? '+' : ''}${fit.slope.toFixed(3)} signal / month`;
    } else $('#plot-trend').textContent = 'Regression line hidden';
    $('#scatter-plot').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${protein.gene} normalized signal by mouse age and type">${content}</svg>`;
    attachPointEvents(points);
  }

  function setupPlot() {
    buildLineOptions();
    buildProteinOptions();
    $('#protein-search').addEventListener('input', event => buildProteinOptions(event.target.value.trim()));
    $('#protein-select').addEventListener('change', event => { chosenProtein = event.target.value; drawPlot(); });
    $('#trend-toggle').addEventListener('change', drawPlot);
    for (const id of ['minimum-age', 'maximum-age']) {
      $(`#${id}`).addEventListener('input', event => {
        const minimum = $('#minimum-age');
        const maximum = $('#maximum-age');
        if (Number(minimum.value) > Number(maximum.value)) {
          if (event.target === minimum) maximum.value = minimum.value;
          else minimum.value = maximum.value;
        }
        $('#minimum-age-value').textContent = `${minimum.value} months`;
        $('#maximum-age-value').textContent = `${maximum.value} months`;
        $('#age-range-label').textContent = `${minimum.value}–${maximum.value} months`;
        drawPlot();
      });
    }
    $('#download-plot').addEventListener('click', () => {
      const plot = $('#scatter-plot svg');
      if (!plot) return;
      const blob = new Blob([new XMLSerializer().serializeToString(plot)], {type: 'image/svg+xml'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${chosenProtein}-age-profile.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.addEventListener('pointerdown', event => { if (!event.target.closest('[data-point]')) hideTooltip(true); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(true); });
    window.addEventListener('scroll', () => hideTooltip(true), {passive: true});
    window.addEventListener('resize', () => hideTooltip(true));
  }

  async function init() {
    setupTabs();
    try {
      const [data, results] = await Promise.all(['/data/explorer.json', '/data/results.json'].map(async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Could not load ${path}`);
        return response.json();
      }));
      explorer = data;
      explorer.proteins.sort((a, b) => a.gene.localeCompare(b.gene) || a.accession.localeCompare(b.accession));
      $('#cohort-mice').textContent = data.cohort.mice.toLocaleString();
      $('#cohort-samples').textContent = data.cohort.samples.toLocaleString();
      $('#cohort-ages').textContent = `${data.cohort.minimum_age}–${data.cohort.maximum_age}`;
      $('#cohort-lines').textContent = String(data.cohort.lines);
      drawOverview(results.age_groups);
      setupPlot();
    } catch (error) {
      $('#scatter-plot').textContent = 'The plot could not be loaded. Refresh the page to try again.';
      $('#overview-age-chart').textContent = 'The chart could not be loaded.';
    }
  }
  init();
})();
