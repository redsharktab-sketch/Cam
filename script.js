(function() {
  "use strict";

  // DOM elements
  const scanBtn = document.getElementById('scanBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusDiv = document.getElementById('status');
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const cameraList = document.getElementById('cameraList');
  const countSpan = document.querySelector('#count');
  const ipDisplay = document.getElementById('ipDisplay');
  const streamImg = document.getElementById('streamImg');
  const manualUrl = document.getElementById('manualUrl');
  const viewBtn = document.getElementById('viewBtn');

  const scanPort = document.getElementById('scanPort');
  const timeoutInput = document.getElementById('timeout');

  // State
  let isScanning = false;
  let abortController = null;
  let foundCameras = [];
  let localSubnet = ''; // e.g., "192.168.1."

  // ---- Utility: set status ----
  function setStatus(msg, isError = false) {
    statusDiv.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i> ${msg}`;
    statusDiv.style.color = isError ? '#ff9eae' : '#9db1e6';
    statusDiv.style.borderColor = isError ? '#8f3f4f' : '#2e3d60';
  }

  // ---- Detect local IP using WebRTC ----
  function detectLocalIP() {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const ipMatch = e.candidate.candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
        if (ipMatch) {
          const ip = ipMatch[0];
          if (!ip.startsWith('192.168.') && !ip.startsWith('10.') && !ip.startsWith('172.')) return;
          // we got a private IP
          const parts = ip.split('.');
          const subnet = parts.slice(0, 3).join('.') + '.';
          pc.close();
          resolve(subnet);
        }
      };
      // fallback: if no candidate after 3s, use default
      setTimeout(() => {
        pc.close();
        resolve('192.168.1.'); // fallback
      }, 3000);
    });
  }

  // ---- Auto-detect and display subnet ----
  async function initNetwork() {
    try {
      const subnet = await detectLocalIP();
      localSubnet = subnet;
      ipDisplay.innerHTML = `<i class="fas fa-network-wired"></i> ${subnet}*`;
    } catch (_) {
      localSubnet = '192.168.1.';
      ipDisplay.innerHTML = `<i class="fas fa-network-wired"></i> ${localSubnet}* (fallback)`;
    }
  }

  // ---- Probe an IP for camera endpoints ----
  function probeCamera(ip, port, timeoutMs) {
    return new Promise((resolve) => {
      const paths = [
        '/snapshot.jpg',
        '/cgi-bin/snapshot.cgi',
        '/image.jpg',
        '/stream',
        '/mjpg.cgi',
        '/jpg/image.jpg',
        '/cgi-bin/stream',
        '/GetData.cgi',
        '/video',
        '/live',
        '/',
      ];
      let found = null;
      let completed = false;

      const checkUrl = (url) => {
        return new Promise((res) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          const timer = setTimeout(() => { img.src = ''; res(false); }, timeoutMs);
          img.onload = () => { clearTimeout(timer); res(true); };
          img.onerror = () => { clearTimeout(timer); res(false); };
          img.src = url;
          // if image is cached, onload may fire immediately
          if (img.complete) {
            clearTimeout(timer);
            res(true);
          }
        });
      };

      // We'll test the first few paths and also try to fetch homepage for name
      const testPaths = paths.slice(0, 6); // limit to 6 to speed up
      (async () => {
        for (const path of testPaths) {
          const url = `http://${ip}:${port}${path}`;
          const ok = await checkUrl(url);
          if (ok) {
            found = { ip, port, path, url };
            break;
          }
          // if path is '/', we also try to get name via fetch (if CORS allows)
          if (path === '/') {
            try {
              const resp = await fetch(`http://${ip}:${port}/`, { mode: 'no-cors', signal: AbortSignal.timeout(timeoutMs) });
              // no-cors gives opaque, but we can't read body, so skip
            } catch (_) {}
          }
        }
        resolve(found);
      })();
    });
  }

  // ---- Scan a range ----
  async function startScan() {
    if (isScanning) return;
    if (!localSubnet) {
      setStatus('Network not detected yet, please wait…', true);
      return;
    }

    const port = parseInt(scanPort.value) || 80;
    const timeoutSec = parseFloat(timeoutInput.value) || 2;
    const timeoutMs = timeoutSec * 1000;

    // We'll scan 1..254
    const startIp = 1;
    const endIp = 254;
    const total = endIp - startIp + 1;

    isScanning = true;
    abortController = new AbortController();
    scanBtn.disabled = true;
    stopBtn.disabled = false;
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    cameraList.innerHTML = '';
    foundCameras = [];
    countSpan.textContent = '(0)';
    setStatus(`Scanning ${localSubnet}* (port ${port})…`);

    let scanned = 0;
    let found = 0;

    for (let i = startIp; i <= endIp; i++) {
      if (abortController.signal.aborted) break;
      const ip = localSubnet + i;
      const result = await probeCamera(ip, port, timeoutMs);
      scanned++;
      if (result) {
        found++;
        foundCameras.push(result);
        addCameraToList(result);
      }
      // Update progress
      const pct = Math.min(100, Math.round((scanned / total) * 100));
      progressFill.style.width = pct + '%';
      countSpan.textContent = `(${found})`;
    }

    isScanning = false;
    scanBtn.disabled = false;
    stopBtn.disabled = true;
    progressWrap.style.display = 'none';
    if (found === 0) {
      setStatus(`No cameras found on ${localSubnet}*:${port}. Try a different port.`, true);
      cameraList.innerHTML = `<li class="placeholder"><i class="fas fa-camera"></i> No cameras discovered</li>`;
    } else {
      setStatus(`Scan complete – found ${found} camera(s)`);
    }
  }

  // ---- Add a camera to the list ----
  function addCameraToList(cam) {
    const li = document.createElement('li');
    li.dataset.url = cam.url;
    const name = cam.name || `Camera at ${cam.ip}`;
    li.innerHTML = `
      <span class="ip">${cam.ip}</span>
      <span class="name">${name}</span>
      <span class="path">${cam.path}</span>
      <span class="status-icon"><i class="fas fa-check-circle" style="color:#4f9aff;"></i></span>
    `;
    li.addEventListener('click', () => {
      // view this camera
      viewStream(cam.url);
    });
    // Try to fetch name from homepage (if we haven't already)
    if (!cam.name) {
      fetch(`http://${cam.ip}:${cam.port}/`, { mode: 'cors', signal: AbortSignal.timeout(2000) })
        .then(res => res.text())
        .then(html => {
          const match = html.match(/<title>(.*?)<\/title>/i);
          if (match) {
            const title = match[1].trim();
            cam.name = title;
            const nameSpan = li.querySelector('.name');
            if (nameSpan) nameSpan.textContent = title;
          }
        })
        .catch(() => {});
    }
    cameraList.appendChild(li);
    if (cameraList.querySelector('.placeholder')) {
      cameraList.querySelector('.placeholder').remove();
    }
  }

  // ---- View a stream ----
  function viewStream(url) {
    streamImg.src = url;
    // Add a timestamp to prevent caching
    streamImg.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
  }

  // ---- Stop scanning ----
  function stopScan() {
    if (abortController) {
      abortController.abort();
    }
    isScanning = false;
    scanBtn.disabled = false;
    stopBtn.disabled = true;
    progressWrap.style.display = 'none';
    setStatus('Scan stopped by user', true);
  }

  // ---- Event listeners ----
  scanBtn.addEventListener('click', startScan);
  stopBtn.addEventListener('click', stopScan);
  viewBtn.addEventListener('click', () => {
    const url = manualUrl.value.trim();
    if (url) viewStream(url);
  });
  manualUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') viewBtn.click();
  });

  // ---- Init ----
  initNetwork().then(() => {
    setStatus('Ready – press Auto‑Scan to discover cameras');
  }).catch(() => {
    setStatus('Could not detect network – using fallback 192.168.1.*', true);
  });
})();
