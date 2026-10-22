import React, { useEffect, useState } from 'react';
import api from '../api.js';

export default function PerformanceMonitor({ activeDatabase, isConnected }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setStats(null); setHistory([]); setError('');
    if (!isConnected || !activeDatabase?.id) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await api.stats(activeDatabase.id);
        if (cancelled) return;
        setStats(data); setError('');
        setHistory((previous) => [...previous.slice(-28), {
          t: new Date().toLocaleTimeString(),
          conns: Number(data.active_connections || 0),
          commits: Number(data.transactions_committed || 0),
          rollbacks: Number(data.transactions_rolled_back || 0),
        }]);
      } catch (e) { if (!cancelled) setError(e.message || 'Falha na leitura'); }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeDatabase?.id, isConnected]);

  const graph = (key, color) => {
    if (history.length < 2) return <p className="astral-chart-empty">Aguardando amostras reais...</p>;
    const data = key === 'tps'
      ? history.map((p, i) => i ? Math.max(0, (p.commits - history[i - 1].commits) / 10) : 0)
      : history.map((p) => p.conns);
    const max = Math.max(1, ...data);
    const points = data.map((v, i) => `${Math.round(12 + i * 288 / (data.length - 1))},${Math.round(112 - v / max * 98)}`).join(' ');
    return <svg viewBox="0 0 312 126" role="img" aria-label="Métricas observadas no PostgreSQL">
      {[14,38,63,88,112].map((y) => <line key={y} x1="12" y1={y} x2="302" y2={y} stroke="#36475a" />)}
      <polyline fill="none" stroke={color} strokeWidth="2.3" strokeLinejoin="round" points={points}/>
    </svg>;
  };
  return <div className="astral-real-monitor">
    <div className="astral-monitor-source"><i className="pi pi-check-circle"/> PostgreSQL · pg_stat_database</div>
    {!isConnected && <p>Conecte um banco para visualizar métricas reais.</p>}
    {error && <p className="astral-monitor-error">{error}</p>}
    {stats && <>
      <div className="astral-stats-row">
        <div><small>Conexões</small><strong>{stats.active_connections}</strong></div>
        <div><small>Commits</small><strong>{Number(stats.transactions_committed).toLocaleString('pt-BR')}</strong></div>
        <div><small>Rollbacks</small><strong>{Number(stats.transactions_rolled_back).toLocaleString('pt-BR')}</strong></div>
      </div>
      <section className="astral-monitor-chart"><header>Conexões ativas <span>10 s</span></header>{graph('conns','#53a9fa')}</section>
      <section className="astral-monitor-chart"><header>Commits/s entre amostras <span>10 s</span></header>{graph('tps','#5bd398')}</section>
      <div className="astral-monitor-foot">Banco: {stats.database_name} · Tamanho: {stats.database_size}</div>
      <div className="astral-monitor-note">CPU e memória não estão disponíveis na API; nenhum dado é simulado.</div>
    </>}
  </div>;
}
