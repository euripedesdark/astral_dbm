import React, { useState, useEffect } from 'react';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';

export default function PerformanceMonitor({ activeDatabase, isConnected }) {
  const [cpu, setCpu] = useState(18);
  const [memory, setMemory] = useState(384);
  const [connections, setConnections] = useState(8);
  const [tps, setTps] = useState(42);
  const [history, setHistory] = useState([
    { t: '10:00', cpu: 12, mem: 340, conn: 6, tps: 20 },
    { t: '10:15', cpu: 28, mem: 360, conn: 9, tps: 65 },
    { t: '10:30', cpu: 15, mem: 355, conn: 8, tps: 34 },
    { t: '10:45', cpu: 35, mem: 380, conn: 12, tps: 88 },
    { t: '11:00', cpu: 18, mem: 384, conn: 8, tps: 42 },
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().toLocaleTimeString().slice(3, 8);
      const newCpu = Math.floor(10 + Math.random() * 30);
      const newMem = Math.floor(370 + Math.random() * 40);
      const newConn = Math.floor(5 + Math.random() * 10);
      const newTps = Math.floor(25 + Math.random() * 60);

      setCpu(newCpu);
      setMemory(newMem);
      setConnections(newConn);
      setTps(newTps);

      setHistory((prev) => {
        const next = [...prev.slice(1), { t: now, cpu: newCpu, mem: newMem, conn: newConn, tps: newTps }];
        return next;
      });
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="perf-monitor-view">
      {/* Top Banner Toolbar */}
      <div className="perf-toolbar">
        <div className="flex align-items-center gap-3">
          <span className="perf-title">
            <i className="pi pi-chart-line text-blue-400 mr-2" />
            Performance Advisor &amp; SQL Monitor
          </span>
          <Tag
            severity={isConnected ? 'success' : 'warning'}
            value={isConnected ? `Monitorando: ${activeDatabase?.nome || 'Banco Ativo'}` : 'Desconectado'}
          />
        </div>
        <div className="flex gap-2">
          <Button icon="pi pi-refresh" label="Real-time" text size="small" />
          <Button icon="pi pi-calendar" label="Last Hour" text size="small" />
        </div>
      </div>

      {/* 2x2 Grid matching Image C */}
      <div className="perf-grid">
        {/* Card 1: CPU Usage */}
        <div className="perf-card">
          <div className="card-header">
            <span>CPU Usage (%)</span>
            <span className="badge-time">Real-time · {cpu}%</span>
          </div>
          <div className="card-body">
            <svg viewBox="0 0 400 140" className="chart-svg">
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#007acc" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#007acc" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <polyline
                fill="url(#cpuGrad)"
                stroke="#007acc"
                strokeWidth="2"
                points={`0,140 0,${140 - history[0].cpu * 2} 80,${140 - history[1].cpu * 2} 160,${140 - history[2].cpu * 2} 240,${140 - history[3].cpu * 2} 320,${140 - history[4].cpu * 2} 400,${140 - cpu * 2} 400,140`}
              />
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
                points={`0,${140 - history[0].cpu * 2} 80,${140 - history[1].cpu * 2} 160,${140 - history[2].cpu * 2} 240,${140 - history[3].cpu * 2} 320,${140 - history[4].cpu * 2} 400,${140 - cpu * 2}`}
              />
            </svg>
            <div className="chart-legend">
              <span className="legend-dot" style={{ background: '#38bdf8' }} /> CPU %
              <span className="legend-dot ml-3" style={{ background: '#f59e0b' }} /> I/O Wait
            </div>
          </div>
        </div>

        {/* Card 2: Memory Usage */}
        <div className="perf-card">
          <div className="card-header">
            <span>Memory Usage (MB)</span>
            <span className="badge-time">Real-time · {memory} MB</span>
          </div>
          <div className="card-body">
            <svg viewBox="0 0 400 140" className="chart-svg">
              <defs>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <polyline
                fill="url(#memGrad)"
                stroke="#10b981"
                strokeWidth="2"
                points={`0,140 0,${140 - (history[0].mem - 300)} 80,${140 - (history[1].mem - 300)} 160,${140 - (history[2].mem - 300)} 240,${140 - (history[3].mem - 300)} 320,${140 - (history[4].mem - 300)} 400,${140 - (memory - 300)} 400,140`}
              />
              <polyline
                fill="none"
                stroke="#34d399"
                strokeWidth="2.5"
                points={`0,${140 - (history[0].mem - 300)} 80,${140 - (history[1].mem - 300)} 160,${140 - (history[2].mem - 300)} 240,${140 - (history[3].mem - 300)} 320,${140 - (history[4].mem - 300)} 400,${140 - (memory - 300)}`}
              />
            </svg>
            <div className="chart-legend">
              <span className="legend-dot" style={{ background: '#34d399' }} /> Buffer Cache
              <span className="legend-dot ml-3" style={{ background: '#a78bfa' }} /> Sort/Work Memory
            </div>
          </div>
        </div>

        {/* Card 3: Active Connections */}
        <div className="perf-card">
          <div className="card-header">
            <span>Active Connections</span>
            <span className="badge-time">Ativas · {connections}</span>
          </div>
          <div className="card-body flex justify-content-around align-items-end pt-4 pb-2" style={{ height: '140px' }}>
            {history.map((h, i) => (
              <div key={i} className="bar-col flex flex-column align-items-center">
                <div
                  className="bar-fill"
                  style={{
                    height: `${Math.max(10, h.conn * 8)}px`,
                    width: '32px',
                    background: '#3b82f6',
                    borderRadius: '4px 4px 0 0',
                  }}
                />
                <span className="text-xs text-muted mt-1">{h.t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card 4: Transactions Per Second (TPS) */}
        <div className="perf-card">
          <div className="card-header">
            <span>Transactions Per Second (TPS)</span>
            <span className="badge-time">Pico · {tps} TPS</span>
          </div>
          <div className="card-body">
            <svg viewBox="0 0 400 140" className="chart-svg">
              <polyline
                fill="none"
                stroke="#eab308"
                strokeWidth="2.5"
                points={`0,${140 - history[0].tps} 80,${140 - history[1].tps} 160,${140 - history[2].tps} 240,${140 - history[3].tps} 320,${140 - history[4].tps} 400,${140 - tps}`}
              />
            </svg>
            <div className="chart-legend">
              <span className="legend-dot" style={{ background: '#eab308' }} /> Commits / seg
              <span className="legend-dot ml-3" style={{ background: '#ef4444' }} /> Rollbacks
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
