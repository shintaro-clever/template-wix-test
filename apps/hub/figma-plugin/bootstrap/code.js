const UI_HTML = `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        margin: 0;
        padding: 1rem;
        background: #0f172a;
        color: #f8fafc;
      }
      h1 {
        font-size: 1.1rem;
        margin-bottom: 0.5rem;
      }
      label {
        display: block;
        margin-bottom: 0.75rem;
      }
      input {
        width: 100%;
        border-radius: 8px;
        border: none;
        padding: 0.5rem;
        margin-top: 0.25rem;
      }
      button {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 0.75rem;
        background: #2563eb;
        color: #fff;
        font-size: 1rem;
        cursor: pointer;
        margin-top: 0.5rem;
      }
      .status {
        margin-top: 0.75rem;
        font-size: 0.85rem;
      }
    </style>
  </head>
  <body>
    <h1>Hub Bootstrap Importer</h1>
    <label>
      Run ID
      <input id="runId" placeholder="mlu..." />
    </label>
    <label>
      Hub Base URL
      <input id="baseUrl" value="http://127.0.0.1:3000" />
    </label>
    <button id="importBtn">Import Bootstrap</button>
    <div class="status" id="status"></div>
    <script>
      const statusEl = document.getElementById('status');
      const runInput = document.getElementById('runId');
      const baseInput = document.getElementById('baseUrl');
      const button = document.getElementById('importBtn');
      button.addEventListener('click', () => {
        parent.postMessage({ pluginMessage: { type: 'import-plan', runId: runInput.value.trim(), baseUrl: baseInput.value.trim() } }, '*');
      });
      window.onmessage = (event) => {
        const msg = event.data.pluginMessage;
        if (!msg) return;
        if (msg.type === 'status') {
          statusEl.textContent = msg.message;
        } else if (msg.type === 'success') {
          statusEl.textContent = `Frames created: ${msg.count}`;
        } else if (msg.type === 'error') {
          statusEl.textContent = `Error: ${msg.message}`;
        }
      };
    </script>
  </body>
</html>`;

figma.showUI(UI_HTML, { width: 360, height: 280 });

function normalizeBaseUrl(raw) {
  const trimmed = (raw || 'http://127.0.0.1:3000').trim().replace(/\/$/, '');
  return trimmed || 'http://127.0.0.1:3000';
}

function ensurePage(name) {
  const existing = figma.root.children.find((node) => node.type === 'PAGE' && node.name === name);
  if (existing) {
    return existing;
  }
  const page = figma.createPage();
  page.name = name;
  return page;
}

async function createFramesOnPage(page, frames, runId) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).catch(async () => {
    await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
  });
  const created = [];
  frames.forEach((frameData, index) => {
    const frame = figma.createFrame();
    frame.name = frameData.name || frameData.frame_name || frameData.route || `Frame ${index + 1}`;
    frame.resize(360, 640);
    const pos = frameData.position || {};
    frame.x = typeof pos.x === 'number' ? pos.x : index * 40;
    frame.y = typeof pos.y === 'number' ? pos.y : index * 50;
    const text = figma.createText();
    text.fontName = { family: 'Inter', style: 'Regular' };
    text.characters = `Source: ${frameData.source_path || '-'}\nRoute: ${frameData.route || '-'}\nRun: ${runId}\nGenerated: ${new Date().toISOString()}`;
    text.fontSize = 12;
    text.x = 16;
    text.y = 16;
    frame.appendChild(text);
    page.appendChild(frame);
    created.push({ node_id: frame.id, name: frame.name });
  });
  return created;
}

async function importPlan(runId, baseUrl) {
  figma.ui.postMessage({ type: 'status', message: 'Fetching plan...' });
  const response = await fetch(`${baseUrl}/api/runs/${runId}/figma-bootstrap-plan`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Plan fetch failed (${response.status}): ${body}`);
  }
  const plan = await response.json();
  const pageName = plan.page_name || 'Hub Bootstrap';
  const page = ensurePage(pageName);
  figma.currentPage = page;
  const nodes = await createFramesOnPage(page, plan.frames || [], runId);
  if (nodes.length) {
    try {
      await fetch(`${baseUrl}/api/runs/${runId}/figma-bootstrap-nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, figma_file_key: plan.figma_file_key })
      });
    } catch (error) {
      figma.ui.postMessage({ type: 'status', message: `ノード保存に失敗: ${error.message}` });
    }
  }
  figma.ui.postMessage({ type: 'success', count: nodes.length });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'import-plan') {
    return;
  }
  const runId = (msg.runId || '').trim();
  if (!runId) {
    figma.ui.postMessage({ type: 'error', message: 'Run ID を入力してください' });
    return;
  }
  try {
    await importPlan(runId, normalizeBaseUrl(msg.baseUrl));
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error.message || 'Unknown error' });
  }
};
