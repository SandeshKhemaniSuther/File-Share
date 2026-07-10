import React, { useState, useEffect, useRef } from 'react';
import { Peer } from 'peerjs';
import { Copy, Check, QrCode, X, Camera, ArrowRight, Zap, UploadCloud, ShieldCheck, ShieldAlert, Cpu, Link2, LogOut, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

function App() {
  const [peerId, setPeerId] = useState('');
  const [remoteId, setRemoteId] = useState('');
  const [connection, setConnection] = useState(null);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('Disconnected');
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [isSecure, setIsSecure] = useState(true);
  
  // Real-time Dashboard Popup states
  const [showTransferPopup, setShowTransferPopup] = useState(false);
  const [transferType, setTransferType] = useState(''); 

  // Global Popup Notification Matrix
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const peerRef = useRef(null);
  const html5QrCodeRef = useRef(null);
  const [logs, setLogs] = useState([]);

  const [showLogs, setShowLogs] = useState(false);

  const pushLog = (msg) => {
    try { setLogs((s) => [ `${new Date().toLocaleTimeString()} — ${msg}`, ...s ].slice(0, 8)); } catch {}
    try { console.info('LOG:', msg); } catch {}
  };

  // Helper to flash premium popups on demand
  const alertTimeoutRef = useRef(null);
  const triggerAlert = (msg, secureState = true, timeout = 2500) => {
    setAlertMessage(msg);
    setIsSecure(secureState);
    setShowAlert(true);
    if (alertTimeoutRef.current) {
      clearTimeout(alertTimeoutRef.current);
      alertTimeoutRef.current = null;
    }
    if (timeout && typeof timeout === 'number') {
      alertTimeoutRef.current = setTimeout(() => {
        setShowAlert(false);
        alertTimeoutRef.current = null;
      }, timeout);
    }
  };

  useEffect(() => {
    const peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });
    peerRef.current = peer;
    peer.on('open', (id) => { setPeerId(id); pushLog(`Local peer open: ${id}`); });
    
    peer.on('connection', (conn) => {
      pushLog('Incoming connection from: ' + conn.peer);
      setConnection(conn);
      setStatus('Connected');
      triggerAlert("Secure Tunnel Established! Device linked successfully.", true);
      setupConnectionListeners(conn);
    });
    peer.on('disconnected', () => {
      pushLog('Peer disconnected from server');
      setStatus('Disconnected');
      triggerAlert('Peer disconnected from server', false, 2200);
    });
    peer.on('error', (err) => {
      pushLog('Peer error: ' + (err?.message || String(err)));
      console.error('Peer error:', err);
      triggerAlert('Peer error: ' + (err?.message || 'Unexpected'), false, 3000);
    });
    return () => peer.destroy();
  }, []);

  // Global runtime error capture to surface issues as popups
  useEffect(() => {
    const onError = (evt) => {
      try {
        const msg = evt?.message || (evt?.reason && evt.reason.message) || 'Runtime error';
        console.warn('Captured error:', evt);
        triggerAlert('Error: ' + String(msg).slice(0, 120), false, 5000);
      } catch {}
    };

    const origConsoleError = console.error;
    console.error = (...args) => {
      try { triggerAlert('Error: ' + String(args?.[0] || args?.join(' ')).slice(0, 120), false, 5000); } catch {}
      origConsoleError.apply(console, args);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
      console.error = origConsoleError;
    };
  }, []);

  const recreatePeer = () => {
    try {
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
    } catch {}

    const newPeer = new Peer({
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    peerRef.current = newPeer;
    newPeer.on('open', (id) => setPeerId(id));
    newPeer.on('connection', (conn) => { pushLog('Incoming connection on recreated peer: ' + conn.peer); setConnection(conn); setStatus('Connected'); setupConnectionListeners(conn); triggerAlert('Secure Tunnel Established', true); });
    newPeer.on('error', (e) => { pushLog('Recreated peer error: ' + (e?.message || String(e))); console.error('recreated peer error', e); triggerAlert('Peer recreate error', false); });
    triggerAlert('Peer recreated — new ID generating', false, 1800);
  };

  const parsePeerIdFromString = (raw) => {
    if (!raw) return '';
    const s = raw.toString().trim();
    // try URL ?id= style
    try {
      const u = new URL(s);
      const qp = u.searchParams.get('id') || u.searchParams.get('peer');
      if (qp) return qp.trim();
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length) return parts.pop().trim();
    } catch {}

    // try common query like id= in plain text
    const idMatch = s.match(/(?:\?|\b)id=([A-Za-z0-9_-]{6,})/i);
    if (idMatch && idMatch[1]) return idMatch[1];

    // fallback: return trimmed string (remove surrounding brackets)
    return s.replace(/^peer:\/\//i, '').replace(/^"|"$/g, '').trim();
  };

  const retryCountsRef = useRef({});

  // 📷 Fixed Fullscreen QR Scanner Lens (Auto-kill loop on successful scan)
  useEffect(() => {
    if (showScanner) {
      const scanner = new Html5Qrcode("camera-reader");
      html5QrCodeRef.current = scanner;
      
      scanner.start(
        { facingMode: "environment" },
        { 
          fps: 20, 
          qrbox: (width, height) => { return { width: width, height: height }; }
        },
        async (decodedText) => {
          const raw = (decodedText || '').toString();
          const peerIdFromQr = raw.trim();

          try {
            if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
              await html5QrCodeRef.current.stop();
              html5QrCodeRef.current = null;
            }
          } catch (err) {
            console.error('QR scanner stop error:', err);
          }

          if (!peerIdFromQr) {
            triggerAlert('Scanned QR is empty or invalid', false);
            return;
          }

          setRemoteId(peerIdFromQr);
          pushLog('QR scanned -> ' + peerIdFromQr);

          // Show a full-screen popup immediately after a successful scan
          try { triggerAlert(`Scanned QR: ${peerIdFromQr} — attempting to connect...`, false, 2000); } catch {}

          // Connect with a short buffer after shutting the camera
          setTimeout(() => {
            try { pushLog('Attempting connect to ' + peerIdFromQr); connectToPeer(peerIdFromQr); } catch (err) { console.error('connectToPeer error:', err); triggerAlert('Connection attempt failed', false); }
          }, 300);
        },
        () => {}
      ).catch(() => triggerAlert("Camera Gateway Access Error", false));
    }
    return () => { if (html5QrCodeRef.current) stopCamera(); };
  }, [showScanner]);

  // Auto-popup alerts on status changes (replace inline status-only messaging)
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === status) return;
    prevStatusRef.current = status;

    // Do not show status popups while transfer modal is active
    if (showTransferPopup) return;

    const statusMap = {
      'Connected': { msg: 'Secure Tunnel Established', secure: true },
      'Disconnected': { msg: 'Shield: Disconnected', secure: false },
      'Pairing...': { msg: 'Attempting to pair with remote node...', secure: false },
      'Streaming': { msg: 'Data stream in progress', secure: true }
    };

    const info = statusMap[status];
    if (info) triggerAlert(info.msg, info.secure, 2800);
  }, [status, showTransferPopup]);

  const stopCamera = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try { await html5QrCodeRef.current.stop(); html5QrCodeRef.current = null; } catch {}
    }
    setShowScanner(false);
  };

  // 📥 RECEIVER SIDE: Disk Storage Safe Stream Engine
  const setupConnectionListeners = (conn) => {
    let receivedChunks = [];
    let fileInfo = null;
    let fileHandle = null;
    let writableStream = null;

    conn.on('data', async (rawString) => {
      let data = rawString;
      if (typeof rawString === 'string') {
        try { data = JSON.parse(rawString); } catch { return; }
      }

      if (data.type === 'start') {
        fileInfo = data;
        receivedChunks = [];
        setProgress(0);
        setTransferType('Receiving');
        setShowTransferPopup(true);
        setStatus('Streaming');

        // Notify user that receiving has started
        try { pushLog('Receiving start: ' + (fileInfo.fileName || 'file')); triggerAlert(`Receiving: ${fileInfo.fileName || 'file'}`, true, 2500); } catch {}

        if ('showSaveFilePicker' in window) {
          try {
            fileHandle = await window.showSaveFilePicker({ suggestedName: fileInfo.fileName });
            writableStream = await fileHandle.createWritable();
          } catch (err) {
            writableStream = null;
          }
        }
      } else if (data.type === 'chunk') {
        const u8Array = new Uint8Array(data.chunk);
        if (writableStream) {
          await writableStream.write(u8Array);
        } else {
          receivedChunks.push(u8Array);
        }
        const currentCount = writableStream ? data.currentChunk + 1 : receivedChunks.length;
        const percent = Math.round((currentCount / data.totalChunks) * 100);
        setProgress(percent);

      } else if (data.type === 'end') {
        if (writableStream) {
          await writableStream.close();
        } else {
          const blob = new Blob(receivedChunks, { type: fileInfo.fileType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileInfo.fileName;
          a.click();
        }

        setProgress(100);
        setStatus('Connected');
        setTimeout(() => {
          setShowTransferPopup(false);
          setProgress(0);
          triggerAlert(`Asset Received: ${fileInfo.fileName}`, true);
        }, 2500);
      }
    });

    conn.on('close', () => {
      pushLog('Connection closed: ' + (conn.peer || 'unknown'));
      setStatus('Disconnected');
      setConnection(null);
      setProgress(0);
      setShowTransferPopup(false);
      triggerAlert("Secure node bridge terminated. Disconnected.", false);
    });
  };

  const connectToPeer = (targetId = remoteId) => {
    const raw = targetId;
    const pid = parsePeerIdFromString(raw);
    if (!pid) { triggerAlert('Invalid target ID', false); return; }

    setStatus('Pairing...');
    if (!peerRef.current) {
      triggerAlert('Local peer not ready', false);
      return;
    }

    retryCountsRef.current[pid] = retryCountsRef.current[pid] || 0;
    if (retryCountsRef.current[pid] > 3) {
      triggerAlert('Failed to connect after multiple attempts', false, 3500);
      return;
    }

    let conn;
    try {
      pushLog('connectToPeer: calling peer.connect -> ' + pid);
      conn = peerRef.current.connect(pid);
    } catch (err) {
      console.error('connect error:', err);
      triggerAlert('Connection initiation failed', false);
      return;
    }

    setConnection(conn);

    let openHandled = false;
    const handleOpen = () => {
      if (openHandled) return; openHandled = true;
      pushLog('Data connection opened to ' + pid);
      // reset retry count on success
      retryCountsRef.current[pid] = 0;
      setStatus('Connected');
      try { triggerAlert(`Secure Tunnel Established with ${pid}`, true, 2600); } catch {}
      setupConnectionListeners(conn);
      if (connectTimeout) clearTimeout(connectTimeout);
    };

    // immediate-open cases
    try { if (conn.open === true || conn._open === true) handleOpen(); } catch {}

    conn.on('open', handleOpen);

    conn.on('error', (err) => {
      console.error('Peer connection error:', err);
      pushLog('Conn error: ' + (err?.message || String(err)));
      triggerAlert('Connection error: ' + (err?.message || 'Unexpected'), false, 3000);
    });

    // if open doesn't fire within X ms, notify user
    const connectTimeout = setTimeout(() => {
      if (!openHandled) {
        pushLog('Connection timeout to ' + pid);
        triggerAlert('Connection timed out. Remote may be offline or blocked.', false, 4000);
      }
    }, 7000);

    conn.on('close', () => {
      pushLog('Data connection closed to ' + pid);
      setStatus('Disconnected');
      setConnection(null);
      triggerAlert('Connection closed', false, 1800);

      // retry with backoff
      retryCountsRef.current[pid] = (retryCountsRef.current[pid] || 0) + 1;
      const backoff = Math.min(3000 * retryCountsRef.current[pid], 10000);
      pushLog(`Scheduling reconnect to ${pid} in ${backoff}ms (attempt ${retryCountsRef.current[pid]})`);
      setTimeout(() => {
        try { connectToPeer(pid); } catch (e) { pushLog('Reconnect failed: ' + String(e)); }
      }, backoff);
    });
  };

  // 📤 SENDER SIDE: High-Speed WebRTC Loop
  const sendFile = async () => {
    if (!connection) return;

    const isOpen = (conn) => {
      try {
        if (!conn) return false;
        if (conn.open === true) return true;
        if (conn._open === true) return true;
        if (conn.dataChannel && conn.dataChannel.readyState === 'open') return true;
        if (conn._dc && conn._dc.readyState === 'open') return true;
        return false;
      } catch { return false; }
    };

    if (!isOpen(connection)) {
      triggerAlert('Connection not ready. Wait a moment and retry.', false);
      return;
    }

    setStatus('Streaming');
    try { triggerAlert('Sending: starting secure stream', true, 2000); } catch {}
    setProgress(0);
    setTransferType('Sending');
    setShowTransferPopup(true);

    const CHUNK_SIZE = 64 * 1024;
    const reader = new FileReader();

    reader.onload = async (e) => {
      const buffer = e.target.result;
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

      try {
        pushLog('Sending start -> ' + file.name + ' chunks:' + totalChunks);
        connection.send({ type: 'start', fileName: file.name, fileType: file.type || 'application/octet-stream', totalChunks });
      } catch (err) {
        console.error('send start error', err);
        triggerAlert('Failed to initiate transfer', false);
        return;
      }

      let currentChunk = 0;

      while (currentChunk < totalChunks) {
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const chunk = buffer.slice(start, end);

        try {
          // send chunk as plain object with Array.from to keep receiver logic
          connection.send({ type: 'chunk', chunk: Array.from(new Uint8Array(chunk)), currentChunk, totalChunks });
        } catch (err) {
          console.error('send chunk error', err);
          triggerAlert('Error while sending data', false);
          return;
        }

        currentChunk++;
        setProgress(Math.round((currentChunk / totalChunks) * 100));

        // light throttle to avoid overwhelming the channel
        await new Promise((res) => setTimeout(res, 15));
      }

      try {
        connection.send({ type: 'end' });
        pushLog('Sent end');
      } catch (err) {
        console.error('send end error', err);
      }

      setStatus('Connected');
      setProgress(100);

      setTimeout(() => {
        setShowTransferPopup(false);
        setProgress(0);
        triggerAlert(`Asset Broadcast Successful: ${file.name}`, true);
        setFile(null);
      }, 2500);
    };

    reader.readAsArrayBuffer(file);
  };

  const disconnectDevices = () => {
    if (connection) connection.close();
  };

  return (
    <div className="flex justify-center items-center min-h-screen w-full px-4 py-6 sm:p-8 box-border">
      
      {/* Animated RGB Card Shell */}
      <div className="relative p-[2px] rounded-2xl rgb-gradient-bg w-full max-w-full sm:max-w-md md:max-w-lg shadow-2xl shadow-purple-500/10 transition-all duration-300">
        <div className="glass-panel p-5 sm:p-7 rounded-[14px] text-slate-200">
          
         {/* Brand Header */}
          <div className="w-full mb-6">
            <div className="w-full h-12 flex items-center px-4 rounded-xl rgb-gradient-bg shadow-lg shadow-purple-500/20 border border-white/10 relative overflow-hidden">
              <div className="flex items-center gap-3 z-10">
                <div className="flex items-center justify-center text-purple-200 drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] animate-pulse">
                  <Zap size={20} className="fill-purple-100/90" />
                </div>
                <span className="text-sm font-black tracking-wider text-white uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">
                  Sandy File Share
                </span>
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_4s_infinite]"></div>
            </div>
          </div>

          {/* ---------------- SCREEN 1: PAIRING CONNECT MODE (Disconnected Screen) ---------------- */}
          {status !== 'Connected' && !showTransferPopup && (
            <div className="animate-fade-in">
              <div className="mb-5">
                <label className="block text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Secure Node Access ID</label>
                <div className="flex justify-between items-center bg-slate-950/60 neon-border-blue p-3 rounded-xl">
                  <span className="font-mono text-xs sm:text-sm text-blue-400 truncate w-2/3 sm:w-3/4">{peerId || 'Generating Firewall Token...'}</span>
                  <div className="flex gap-1.5 sm:gap-2">
                    <button 
                      onClick={() => { navigator.clipboard.writeText(peerId); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      className="p-1.5 sm:p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition"
                    >
                      {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                    </button>
                    <button onClick={() => setShowQR(!showQR)} className="p-1.5 sm:p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-purple-400 transition">
                      <QrCode size={16} />
                    </button>
                    <button onClick={recreatePeer} className="p-1.5 sm:p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-emerald-400 transition" title="Refresh ID">
                      <RefreshCw size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {showQR && peerId && (
                <div className="flex flex-col items-center p-4 bg-white/5 rounded-xl border border-white/10 mb-5 max-w-full overflow-hidden animate-fade-in">
                  <div className="p-2 bg-white rounded-lg shadow-lg max-w-full">
                    <QRCodeSVG value={peerId} className="w-32 h-32 sm:w-36 sm:h-36" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 text-center">Scan securely to pair endpoints</p>
                </div>
              )}

              <div className="mb-5">
                <label className="block text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Target Gateway</label>
                <div className="flex flex-row gap-2 w-full">
                  <input 
                    type="text" 
                    placeholder="Target ID" 
                    value={remoteId}
                    onChange={(e) => setRemoteId(e.target.value)}
                    className="flex-1 min-w-0 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:border-purple-500 transition"
                  />
                  <button 
                    onClick={() => connectToPeer(remoteId)} 
                    className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm px-3 sm:px-4 rounded-xl shadow-lg active:scale-95 transition flex items-center"
                    disabled={!remoteId}
                  >
                    <ArrowRight size={16} />
                  </button>
                  <button 
                    onClick={() => setShowScanner(true)} 
                    className="bg-slate-800 hover:bg-slate-700 text-purple-400 border border-purple-500/30 p-2 sm:p-2.5 rounded-xl transition flex items-center shrink-0"
                  >
                    <Camera size={18} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Camera Viewfinder Overlay Modal (Single Frame Only) */}
          {showScanner && (
            <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex flex-col justify-center items-center z-50 p-4 animate-fade-in box-border">
              <div className="w-full max-w-sm rounded-2xl border border-purple-500/20 p-5 glass-panel text-center relative">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs sm:text-sm font-bold tracking-wider text-purple-400 uppercase">Encrypted Lens Tunnel</span>
                  <button onClick={stopCamera} className="p-1 hover:bg-slate-800 rounded-full text-slate-400 hover:text-rose-400 transition"><X size={20} /></button>
                </div>
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black flex items-center justify-center">
                  <div id="camera-reader" className="w-full h-full absolute inset-0 [&_span]:!hidden [&_div]:!border-none [&_div]:!box-shadow-none"></div>
                  <div className="absolute w-[200px] h-[200px] border border-purple-500/40 pointer-events-none z-10 flex items-center justify-center rounded-lg shadow-[0_0_30px_rgba(168,85,247,0.25)]">
                    <div className="absolute -top-[2px] -left-[2px] w-5 h-5 border-t-4 border-l-4 border-purple-400 rounded-tl-md"></div>
                    <div className="absolute -top-[2px] -right-[2px] w-5 h-5 border-t-4 border-r-4 border-purple-400 rounded-tr-md"></div>
                    <div className="absolute -bottom-[2px] -left-[2px] w-5 h-5 border-b-4 border-l-4 border-purple-400 rounded-bl-md"></div>
                    <div className="absolute -bottom-[2px] -right-[2px] w-5 h-5 border-b-4 border-r-4 border-purple-400 rounded-br-md"></div>
                    <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_12px_rgba(168,85,247,1)] animate-[scanLine_2s_ease-in-out_infinite]"></div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-4 tracking-wide font-medium">Position target QR matrix code fully within framework</p>
              </div>
            </div>
          )}

          {/* ---------------- SECTION 2: AUTO TRANSFER PANEL (Connected Screen) ---------------- */}
          {status === 'Connected' && (
            <div className="animate-fade-in w-full">
              <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900/40 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between mb-5 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 animate-pulse">
                    <Link2 size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black tracking-wide text-emerald-400 uppercase">Secure Link Secured</h4>
                    <p className="text-[10px] text-slate-400 font-mono truncate w-40 sm:w-56">Channel status synchronized</p>
                  </div>
                </div>
                <button onClick={disconnectDevices} className="p-2 bg-slate-950/40 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 rounded-lg text-slate-400 hover:text-rose-400 transition">
                  <LogOut size={16} />
                </button>
              </div>

              <label className="block text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Isolated Sandbox Dropper</label>
              
              <div className="relative w-full mb-3">
                <input type="file" onChange={(e) => setFile(e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20" />
                <button className="w-full bg-slate-800 hover:bg-slate-700 text-purple-400 font-bold text-xs sm:text-sm py-2.5 rounded-xl border border-purple-500/30 shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 tracking-wide uppercase">
                  <UploadCloud size={16} /> Select File
                </button>
              </div>

              <div className="border-2 border-dashed border-slate-800 rounded-xl p-4 text-center bg-slate-950/10 mb-4">
                <p className="text-[11px] sm:text-xs text-slate-400 px-2 truncate max-w-full font-mono">
                  {file ? <span className="text-emerald-400 font-bold">Verified: {file.name}</span> : "No asset loaded in isolation barrier"}
                </p>
              </div>

              <button 
                onClick={sendFile} 
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm py-2.5 sm:py-3 rounded-xl shadow-lg active:scale-[0.98] transition uppercase tracking-wide neon-border-green"
                disabled={!file || progress > 0}
              >
                Fire Secure Stream
              </button>
            </div>
          )}

          {/* --- ACTIVE SYSTEM TRANSFER MOVEMENT MODAL POPUP --- */}
          {showTransferPopup && (
            <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex justify-center items-center z-50 p-4 animate-fade-in">
              <div className="relative p-[2px] rounded-2xl rgb-gradient-bg w-full max-w-sm shadow-2xl shadow-purple-500/30">
                <div className="glass-panel p-6 rounded-[14px] text-center text-slate-200">
                  <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/40 flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <Cpu size={32} className="text-purple-400 animate-spin [animation-duration:8s]" />
                  </div>
                  <h3 className="text-lg font-black tracking-wider text-transparent bg-clip-text rgb-gradient-bg uppercase neon-text-rgb">
                    {transferType} Data Stream
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-mono truncate px-4">
                    Payload: {file ? file.name : 'Streaming Encrypted Packets...'}
                  </p>
                  <div className="my-6">
                    <span className="text-5xl font-black font-mono tracking-tighter text-white drop-shadow-[0_0_12px_rgba(168,85,247,0.5)]">
                      {progress}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-white/5 p-[1px] mb-4">
                    <div className="rgb-gradient-bg h-full rounded-full transition-all duration-150 shadow-[0_0_8px_rgba(59,130,246,0.6)]" style={{ width: `${progress}%` }}></div>
                  </div>
                  <div className="bg-slate-950/60 rounded-xl p-2.5 border border-purple-500/20 text-[10px] sm:text-xs font-mono tracking-wide text-purple-300">
                    🛡️ WebRTC Tunnel Operational at Max Capacity
                  </div>
                  {progress < 100 && (
                    <button 
                      onClick={() => { setShowTransferPopup(false); if(connection) connection.close(); }}
                      className="mt-4 text-[10px] text-rose-400 hover:text-rose-300 uppercase tracking-widest font-bold transition duration-200"
                    >
                      Abort Stream
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* --- 🎯 GLOBAL DIALOG ALERT MODAL POPUP (Completely replaces the old strip) --- */}
          {showAlert && (
            <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex justify-center items-center z-50 p-4 animate-fade-in">
              <div className={`relative p-[1.5px] rounded-2xl w-full max-w-xs shadow-2xl transition-all duration-300 ${isSecure ? 'bg-emerald-500/40 shadow-emerald-500/10' : 'bg-blue-500/40 shadow-blue-500/10'}`}>
                <div className="glass-panel p-5 rounded-[14px] text-center text-slate-200">
                  <div className="flex justify-center mb-3">
                    {isSecure ? (
                      <div className="p-3 bg-emerald-500/10 rounded-full text-emerald-400 border border-emerald-500/30">
                        <ShieldCheck size={28} />
                      </div>
                    ) : (
                      <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 border border-blue-500/30">
                        <ShieldAlert size={28} />
                      </div>
                    )}
                  </div>
                  <h4 className={`text-sm font-black tracking-wider uppercase mb-1 ${isSecure ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {isSecure ? "System Secure" : "System Alert"}
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium mb-4 px-2">
                    {alertMessage}
                  </p>
                  <button 
                    onClick={() => setShowAlert(false)}
                    className={`w-full font-bold text-xs py-2 rounded-xl uppercase tracking-wider transition active:scale-95 ${
                      isSecure ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg'
                    }`}
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
      {/* Log panel toggle + panel */}
      <div className="fixed left-4 bottom-4 z-50">
        <button onClick={() => setShowLogs((s) => !s)} className="mb-2 p-2 rounded-full bg-slate-800 text-slate-200 shadow-lg">Logs</button>
        {showLogs && (
          <div className="w-80 max-w-xs bg-black/80 text-slate-200 rounded-lg p-3 shadow-xl">
            <div className="text-xs font-bold mb-2">Recent Logs</div>
            <div className="text-[11px] max-h-48 overflow-auto font-mono space-y-1">
              {logs.length === 0 ? <div className="text-slate-400">No logs yet</div> : logs.map((l, i) => <div key={i} className="text-slate-300">{l}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
