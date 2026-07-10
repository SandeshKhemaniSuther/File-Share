import React, { useState, useEffect, useRef } from 'react';
import { Peer } from 'peerjs';
import { Copy, Check, QrCode, X, Camera, ArrowRight, Zap, UploadCloud, ShieldCheck, ShieldAlert, Cpu, Link2, LogOut } from 'lucide-react';
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

  const peerRef = useRef(null);
  const html5QrCodeRef = useRef(null);

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
    peer.on('open', (id) => setPeerId(id));

    peer.on('connection', (conn) => {
      setConnection(conn);
      setStatus('Connected');
      setupConnectionListeners(conn);
    });
    return () => peer.destroy();
  }, []);

  useEffect(() => {
    if (showScanner) {
      const scanner = new Html5Qrcode("camera-reader");
      html5QrCodeRef.current = scanner;
      scanner.start(
        { facingMode: "environment" },
        {
          fps: 15, qrbox: (width, height) => {
            const minSize = Math.min(width, height);
            const size = Math.floor(minSize * 0.65);
            return { width: size, height: size };
          }
        },
        (decodedText) => {
          setRemoteId(decodedText);
          stopCamera();
        },
        () => { }
      ).catch(() => setStatus("Camera Error"));
    }
    return () => { if (html5QrCodeRef.current) stopCamera(); };
  }, [showScanner]);

  const stopCamera = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try { await html5QrCodeRef.current.stop(); html5QrCodeRef.current = null; } catch { }
    }
    setShowScanner(false);
  };

  // 📥 RECEIVER SIDE: 5GB+ Large File Stream Handler
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
        setStatus('Syncing Stream...');

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
          setStatus('Saved to Storage!');
        } else {
          const blob = new Blob(receivedChunks, { type: fileInfo.fileType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileInfo.fileName;
          a.click();
          setStatus('Download Complete!');
        }

        setProgress(100);
        setTimeout(() => {
          setShowTransferPopup(false);
          setProgress(0);
          setStatus('Connected');
        }, 2500);
      }
    });

    conn.on('close', () => {
      setStatus('Disconnected');
      setConnection(null);
      setIsSecure(true);
      setProgress(0);
      setShowTransferPopup(false);
    });
  };

  const connectToPeer = (targetId = remoteId) => {
    if (!targetId) return;
    setStatus('Pairing Devices...');

    const conn = peerRef.current.connect(targetId, {
      reliable: true,
      serialization: 'none'
    });

    setConnection(conn);
    conn.on('open', () => {
      setStatus('Connected');
      setupConnectionListeners(conn);
    });
  };

  // 📤 SENDER SIDE: Data Stream Loop
  const sendFile = () => {
    if (!connection) return;
    const dataChannel = connection._dc || connection.dataChannel;

    if (!dataChannel || dataChannel.readyState !== 'open') {
      setStatus("Syncing Channel...");
      setTimeout(() => { sendFile(); }, 1000);
      return;
    }

    setStatus('Streaming Data (MB/s)...');
    setProgress(0);
    setTransferType('Sending');
    setShowTransferPopup(true);

    const CHUNK_SIZE = 64 * 1024;
    const reader = new FileReader();

    reader.onload = async (e) => {
      const buffer = e.target.result;
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

      dataChannel.send(JSON.stringify({
        type: 'start',
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        totalChunks
      }));

      let currentChunk = 0;

      const streamChunks = () => {
        while (currentChunk < totalChunks) {
          if (dataChannel.bufferedAmount > 1024 * 1024) {
            dataChannel.onbufferedamountlow = () => {
              dataChannel.onbufferedamountlow = null;
              streamChunks();
            };
            return;
          }

          const start = currentChunk * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
          const chunk = buffer.slice(start, end);

          dataChannel.send(JSON.stringify({
            type: 'chunk',
            chunk: Array.from(new Uint8Array(chunk)),
            currentChunk,
            totalChunks
          }));

          currentChunk++;
          setProgress(Math.round((currentChunk / totalChunks) * 100));
        }

        dataChannel.send(JSON.stringify({ type: 'end' }));
        setStatus('Broadcast Successful!');
        setProgress(100);

        setTimeout(() => {
          setShowTransferPopup(false);
          setProgress(0);
          setFile(null);
          setStatus('Connected');
        }, 2500);
      };

      dataChannel.bufferedAmountLowThreshold = 256 * 1024;
      streamChunks();
    };

    reader.readAsArrayBuffer(file);
  };

  const disconnectDevices = () => {
    if (connection) {
      connection.close();
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen w-full px-4 py-6 sm:p-8 box-border">

      {/* Animated RGB Outer Ring Container */}
      <div className="relative p-[2px] rounded-2xl rgb-gradient-bg w-full max-w-full sm:max-w-md md:max-w-lg shadow-2xl shadow-purple-500/10 transition-all duration-300">

        {/* Main Interface Box */}
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

          {/* ---------------- SECTION 1: PAIRING CONNECT MODE (Disconnected Screen) ---------------- */}
          {status !== 'Connected' && !status.includes('Streaming') && (
            <div className="animate-fade-in">
              {/* My Node Token */}
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
                  </div>
                </div>
              </div>

              {/* QR Render Grid */}
              {showQR && peerId && (
                <div className="flex flex-col items-center p-4 bg-white/5 rounded-xl border border-white/10 mb-5 max-w-full overflow-hidden animate-fade-in">
                  <div className="p-2 bg-white rounded-lg shadow-lg max-w-full">
                    <QRCodeSVG value={peerId} className="w-32 h-32 sm:w-36 sm:h-36" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 text-center">Scan securely to pair endpoints</p>
                </div>
              )}

              {/* Gateway Connect Entry */}
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
                    onClick={() => connectToPeer()}
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

          {/* --- Zapya-Style Custom Viewfinder Camera Overlay Modal --- */}
          {showScanner && (
            <div className="fixed inset-0 bg-slate-950/95 flex justify-center items-center z-50 p-4 box-border animate-fade-in">
              <div className="glass-panel neon-border-purple p-4 rounded-2xl w-full max-w-sm text-center relative box-border">

                {/* Modal Header */}
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs sm:text-sm font-bold tracking-wider text-purple-400 uppercase">Encrypted Lens Tunnel</span>
                  <button onClick={stopCamera} className="p-1 hover:bg-slate-800 rounded-full text-slate-400 hover:text-rose-400 transition">
                    <X size={20} />
                  </button>
                </div>

                {/* Target Box Area */}
                <div className="relative w-full rounded-xl overflow-hidden bg-black aspect-square flex items-center justify-center">

                  {/* Live Camera Layer (Hidden default library borders via styling classes) */}
                  <div id="camera-reader" className="w-full h-full absolute inset-0 [&_span]:!hidden [&_div]:!border-none [&_div]:!box-shadow-none"></div>

                  {/* 🎯 ONLY ONE PERFECT CYBERPUNK RECTANGLE BOX */}
                  <div className="absolute w-[200px] h-[200px] border border-purple-500/30 pointer-events-none z-10 flex items-center justify-center rounded-lg shadow-[0_0_25px_rgba(168,85,247,0.2)]">

                    {/* Neon Corners */}
                    <div className="absolute -top-[2px] -left-[2px] w-5 h-5 border-t-4 border-l-4 border-purple-400 rounded-tl-md"></div>
                    <div className="absolute -top-[2px] -right-[2px] w-5 h-5 border-t-4 border-r-4 border-purple-400 rounded-tr-md"></div>
                    <div className="absolute -bottom-[2px] -left-[2px] w-5 h-5 border-b-4 border-l-4 border-purple-400 rounded-bl-md"></div>
                    <div className="absolute -bottom-[2px] -right-[2px] w-5 h-5 border-b-4 border-r-4 border-purple-400 rounded-br-md"></div>

                    {/* Animated Matrix Scan Laser Line */}
                    <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_10px_rgba(168,85,247,1)] animate-[scanLine_2s_ease-in-out_infinite]"></div>
                  </div>

                </div>

                <p className="text-[11px] sm:text-xs text-slate-400 mt-4">
                  Fit the QR code completely inside the target frame
                </p>
              </div>
            </div>
          )}

          {/* ---------------- SECTION 2: AUTO TRANSFER PANEL (Connected Screen) ---------------- */}
          {(status === 'Connected' || status.includes('Streaming') || showTransferPopup) && (
            <div className="animate-fade-in w-full">

              {/* Linked Device Banner Card */}
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
                {/* Disconnect active connection */}
                <button
                  onClick={disconnectDevices}
                  className="p-2 bg-slate-950/40 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 rounded-lg text-slate-400 hover:text-rose-400 transition"
                  title="Disconnect Channel"
                >
                  <LogOut size={16} />
                </button>
              </div>

              <label className="block text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Isolated Sandbox Dropper</label>

              {/* Standalone Premium File Selection Trigger */}
              <div className="relative w-full mb-3">
                <input type="file" onChange={(e) => setFile(e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20" />
                <button className="w-full bg-slate-800 hover:bg-slate-700 text-purple-400 font-bold text-xs sm:text-sm py-2.5 rounded-xl border border-purple-500/30 shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 tracking-wide uppercase">
                  <UploadCloud size={16} /> Select File
                </button>
              </div>

              {/* File Loading Verified Display Board */}
              <div className="border-2 border-dashed border-slate-800 rounded-xl p-4 text-center bg-slate-950/10 mb-4">
                <p className="text-[11px] sm:text-xs text-slate-400 px-2 truncate max-w-full font-mono">
                  {file ? <span className="text-emerald-400 font-bold">Verified: {file.name}</span> : "No asset loaded in isolation barrier"}
                </p>
              </div>

              {/* Fire/Send Button */}
              <button
                onClick={sendFile}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm py-2.5 sm:py-3 rounded-xl shadow-lg active:scale-[0.98] transition uppercase tracking-wide neon-border-green"
                disabled={!file || progress > 0}
              >
                Fire Secure Stream
              </button>
            </div>
          )}

          {/* Network Real-time Status Strip Protection Shield */}
          <div className={`p-3 rounded-xl border flex items-center justify-between text-[11px] sm:text-xs font-bold tracking-wider uppercase mt-5 transition-all duration-300 ${status.includes('Complete') || status === 'Connected' || status.includes('Successful')
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400 neon-border-green'
              : 'bg-blue-950/40 border-blue-500/30 text-blue-400 neon-border-blue'
            }`}>
            <span className="truncate">Shield: {status}</span>
            {status === 'Connected' || status.includes('Complete') ? <ShieldCheck size={18} className="shrink-0 text-emerald-400" /> : <ShieldAlert size={18} className="shrink-0 text-blue-400" />}
          </div>

          {/* --- REAL-TIME TRANSFER POPUP OVERLAY PANEL --- */}
          {showTransferPopup && (
            <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex justify-center items-center z-50 p-4 animate-fade-in">
              <div className="relative p-[2px] rounded-2xl rgb-gradient-bg w-full max-w-sm shadow-2xl shadow-purple-500/30">
                <div className="glass-panel p-6 rounded-[14px] text-center text-slate-200">

                  <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/40 flex items-center justify-center mx-auto mb-4 animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.2)]">
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
                    🛡️ {status}
                  </div>

                  {progress < 100 && (
                    <button
                      onClick={() => { setShowTransferPopup(false); if (connection) connection.close(); }}
                      className="mt-4 text-[10px] text-rose-400 hover:text-rose-300 uppercase tracking-widest font-bold transition duration-200"
                    >
                      Abort Stream
                    </button>
                  )}

                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;
