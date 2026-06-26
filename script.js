(function() {
  "use strict";

  // ========== DOM refs ==========
  const tabs = document.querySelectorAll('.tab');
  const networkPanel = document.getElementById('networkMode');
  const bluetoothPanel = document.getElementById('bluetoothMode');

  // Network elements
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

  // Bluetooth elements
  const bleScanBtn = document.getElementById('bleScanBtn');
  const bleDisconnectBtn = document.getElementById('bleDisconnectBtn');
  const bleStatus = document.getElementById('bleStatus');
  const bleDeviceList = document.getElementById('bleDeviceList');
  const bleCount = document.getElementById('bleCount');
  const bleDetailPanel = document.getElementById('bleDetailPanel');
  const deviceNameSpan = document.getElementById('deviceName');
  const deviceIdSpan = document.getElementById('deviceId');
  const deviceConnectedSpan = document.getElementById('deviceConnected');
  const serviceList = document.getElementById('serviceList');

  // ========== Tab switching ==========
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      if (mode === 'network') {
        networkPanel.style.display = 'block';
        bluetoothPanel.style.display = 'none';
      } else {
        networkPanel.style.display = 'none';
        bluetoothPanel.style.display = 'block';
      }
    });
  });

  // ========== NETWORK SCANNER ==========
  let isScanning = false;
  let abortController = null;
  let foundCameras = [];
  let localSubnet = '';

  function setStatus(msg, isError = false) {
    statusDiv.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i> ${msg}`;
    statusDiv.style.color = isError ? '#ff9eae' : '#9db1e6';
    statusDiv.style.borderColor = isError ? '#8f3f4f' : '#2e3d60';
  }

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
          const parts = ip.split('.');
          const subnet = parts.slice(0, 3).join('.') + '.';
          pc.close();
          resolve(subnet);
        }
      };
      setTimeout(() => {
        pc.close();
        resolve('192.168.1.');
      }, 3000);
    });
  }

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
  initNetwork();

  function probeCamera(ip, port, timeoutMs) {
    return new Promise((resolve) => {
      const paths = [
        '/snapshot.jpg', '/cgi-bin/snapshot.cgi', '/image.jpg',
        '/stream', '/mjpg.cgi', '/jpg/image.jpg',
        '/cgi-bin/stream', '/GetData.cgi', '/video', '/live', '/'
      ];
      let found = null;
      const checkUrl = (url) => {
        return new Promise((res) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          const timer = setTimeout(() => { img.src = ''; res(false); }, timeoutMs);
          img.onload = () => { clearTimeout(timer); res(true); };
          img.onerror = () => { clearTimeout(timer); res(false); };
          img.src = url;
          if (img.complete) { clearTimeout(timer); res(true); }
        });
      };
      (async () => {
        for (const path of paths.slice(0, 6)) {
          const url = `http://${ip}:${port}${path}`;
          const ok = await checkUrl(url);
          if (ok) {
            found = { ip, port, path, url };
            break;
          }
        }
        resolve(found);
      })();
    });
  }

  async function startScan() {
    if (isScanning) return;
    if (!localSubnet) { setStatus('Network not detected yet…', true); return; }
    const port = parseInt(scanPort.value) || 80;
    const timeoutSec = parseFloat(timeoutInput.value) || 2;
    const timeoutMs = timeoutSec * 1000;
    const startIp = 1, endIp = 254, total = endIp - startIp + 1;

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

    let scanned = 0, found = 0;
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
      const pct = Math.min(100, Math.round((scanned / total) * 100));
      progressFill.style.width = pct + '%';
      countSpan.textContent = `(${found})`;
    }
    isScanning = false;
    scanBtn.disabled = false;
    stopBtn.disabled = true;
    progressWrap.style.display = 'none';
    if (found === 0) {
      setStatus(`No cameras found on ${localSubnet}*:${port}. Try different port.`, true);
      cameraList.innerHTML = `<li class="placeholder"><i class="fas fa-camera"></i> No cameras discovered</li>`;
    } else {
      setStatus(`Scan complete – found ${found} camera(s)`);
    }
  }

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
    li.addEventListener('click', () => viewStream(cam.url));
    // Try to fetch name from homepage
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
    const ph = cameraList.querySelector('.placeholder');
    if (ph) ph.remove();
  }

  function viewStream(url) {
    streamImg.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
  }

  function stopScan() {
    if (abortController) abortController.abort();
    isScanning = false;
    scanBtn.disabled = false;
    stopBtn.disabled = true;
    progressWrap.style.display = 'none';
    setStatus('Scan stopped by user', true);
  }

  scanBtn.addEventListener('click', startScan);
  stopBtn.addEventListener('click', stopScan);
  viewBtn.addEventListener('click', () => {
    const url = manualUrl.value.trim();
    if (url) viewStream(url);
  });
  manualUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') viewBtn.click(); });

  // ========== BLUETOOTH SCANNER ==========
  let bleDevice = null;
  let bleServer = null;

  function setBleStatus(msg, isError = false) {
    bleStatus.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i> ${msg}`;
    bleStatus.style.color = isError ? '#ff9eae' : '#9db1e6';
    bleStatus.style.borderColor = isError ? '#8f3f4f' : '#2e3d60';
  }

  function addBleDeviceToList(device) {
    const li = document.createElement('li');
    li.dataset.deviceId = device.id;
    li.innerHTML = `
      <span class="dev-name">${device.name || 'Unnamed'}</span>
      <span class="dev-id">${device.id}</span>
      <span class="dev-status"><i class="fas fa-circle" style="color:#4f9aff; font-size:0.6rem;"></i></span>
    `;
    li.addEventListener('click', () => connectBleDevice(device));
    bleDeviceList.appendChild(li);
    const ph = bleDeviceList.querySelector('.placeholder');
    if (ph) ph.remove();
    bleCount.textContent = `(${bleDeviceList.children.length})`;
  }

  async function scanBle() {
    if (!navigator.bluetooth) {
      setBleStatus('Web Bluetooth not supported in this browser. Use Chrome/Edge over HTTPS.', true);
      return;
    }
    setBleStatus('Scanning for Bluetooth devices…');
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [] // we can add common services if needed
      });
      // Device selected from browser picker
      addBleDeviceToList(device);
      setBleStatus(`Found device: ${device.name || 'Unnamed'}`);
      // Auto-connect?
      // We'll let user click to connect.
    } catch (err) {
      if (err.name === 'NotFoundError') {
        setBleStatus('No device selected or scan cancelled.', true);
      } else {
        setBleStatus(`Error: ${err.message}`, true);
      }
    }
  }

  async function connectBleDevice(device) {
    if (bleDevice && bleDevice.id === device.id && bleServer && bleServer.connected) {
      setBleStatus('Already connected to this device.');
      return;
    }
    // Disconnect previous
    if (bleServer && bleServer.connected) {
      try { await bleServer.disconnect(); } catch (_) {}
    }
    setBleStatus(`Connecting to ${device.name || device.id}…`);
    try {
      bleServer = await device.gatt.connect();
      bleDevice = device;
      // Update UI
      deviceNameSpan.textContent = device.name || 'Unnamed';
      deviceIdSpan.textContent = device.id;
      deviceConnectedSpan.textContent = 'Yes';
      bleDetailPanel.style.display = 'block';
      bleDisconnectBtn.disabled = false;
      setBleStatus(`Connected to ${device.name || device.id}`);

      // Get services
      const services = await bleServer.getPrimaryServices();
      serviceList.innerHTML = '';
      if (services.length === 0) {
        serviceList.innerHTML = '<li class="placeholder">No services found</li>';
      }
      for (const svc of services) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="uuid">${svc.uuid}</span>`;
        // Get characteristics
        try {
          const chars = await svc.getCharacteristics();
          if (chars.length) {
            const charUuids = chars.map(c => c.uuid).join(', ');
            li.innerHTML += ` <span class="chars">[${charUuids}]</span>`;
          }
        } catch (_) {}
        serviceList.appendChild(li);
      }
    } catch (err) {
      setBleStatus(`Connection error: ${err.message}`, true);
      bleDetailPanel.style.display = 'none';
      bleDisconnectBtn.disabled = true;
    }
  }

  async function disconnectBle() {
    if (bleServer && bleServer.connected) {
      try {
        await bleServer.disconnect();
        setBleStatus('Disconnected');
      } catch (_) {}
    }
    bleDevice = null;
    bleServer = null;
    deviceNameSpan.textContent = '-';
    deviceIdSpan.textContent = '-';
    deviceConnectedSpan.textContent = 'No';
    bleDetailPanel.style.display = 'none';
    bleDisconnectBtn.disabled = true;
  }

  bleScanBtn.addEventListener('click', scanBle);
  bleDisconnectBtn.addEventListener('click', disconnectBle);

  // Handle disconnect event from device
  if (navigator.bluetooth) {
    // We can't listen to disconnect globally easily; user will click disconnect.
  }

  // ========== INIT ==========
  setStatus('Ready – press Auto‑Scan to discover cameras');
})();
