import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Toast } from 'primereact/toast';
import { TabView, TabPanel } from 'primereact/tabview';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import api from './api.js';
import ConexoesPanel from './components/ConexoesPanel.jsx';
import Explorer from './components/Explorer.jsx';
import DataBrowser from './components/DataBrowser.jsx';
import StructureView from './components/StructureView.jsx';
import SqlConsole from './components/SqlConsole.jsx';

export default function App() {
  const toast = useRef(null);
  const [conexoes, setConexoes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [objeto, setObjeto] = useState(null);
  const [aba, setAba] = useState(0);

  const carregar = useCallback(async () => {
    try {
      const [cs, ds, gs] = await Promise.all([api.conexoes(), api.drivers(), api.grupos()]);
      setConexoes(cs);
      setDrivers(ds);
      setGrupos(gs);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Falha ao carregar', detail: e.message, life: 8000 });
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const abrirObjeto = (schema, tabela, tipo) => {
    setObjeto({ schema, tabela, tipo });
    setAba(0);
  };

  const selecionarConexao = (c) => {
    setSelecionada(c);
    setObjeto(null);
  };

  const conectar = async () => {
    if (!selecionada) {
      return;
    }
    try {
      const r = await api.testarConexao(selecionada.id);
      toast.current?.show({ severity: 'success', summary: `Conectado a ${selecionada.nome}`, detail: r.versao, life: 4000 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Falha na conexão', detail: e.message, life: 8000 });
    }
  };

  return (
    <div className="app">
      <Toast ref={toast} />

      <header className="topbar">
        <div className="marca">
          <i className="pi pi-database" />
          <span>Astral <strong>Database Manager</strong></span>
        </div>
        <div className="conexao-atual">
          {selecionada ? (
            <>
              <i className="pi pi-link" />
              <strong>{selecionada.nome}</strong>
              <span className="url">{selecionada.url}</span>
              {selecionada.somenteLeitura && <Tag value="somente leitura" severity="warning" />}
              <Button icon="pi pi-bolt" label="Testar" text onClick={conectar} />
            </>
          ) : (
            <span className="vazio">Nenhuma conexão selecionada</span>
          )}
        </div>
      </header>

      <div className="corpo">
        <aside className="lateral">
          <ConexoesPanel
            conexoes={conexoes}
            drivers={drivers}
            grupos={grupos}
            selecionada={selecionada}
            onSelecionar={selecionarConexao}
            onMudou={carregar}
            toast={toast}
          />
          <Explorer
            conexaoId={selecionada?.id}
            esquemaInicial={selecionada?.esquemaPadrao}
            onAbrirTabela={abrirObjeto}
            toast={toast}
          />
        </aside>

        <main className="principal">
          {!selecionada ? (
            <div className="boas-vindas">
              <i className="pi pi-database" />
              <h2>Astral Database Manager</h2>
              <p>Crie ou selecione uma conexão para navegar no banco, ver estrutura e executar SQL.</p>
            </div>
          ) : (
            <TabView activeIndex={aba} onTabChange={(e) => setAba(e.index)}>
              <TabPanel header="Dados" leftIcon="pi pi-table">
                {objeto ? (
                  <DataBrowser conexaoId={selecionada.id} schema={objeto.schema} tabela={objeto.tabela} toast={toast} />
                ) : (
                  <div className="vazio-aba">Escolha uma tabela no Explorer.</div>
                )}
              </TabPanel>
              <TabPanel header="Estrutura" leftIcon="pi pi-sitemap">
                {objeto ? (
                  <StructureView conexaoId={selecionada.id} schema={objeto.schema} tabela={objeto.tabela} toast={toast} />
                ) : (
                  <div className="vazio-aba">Escolha uma tabela no Explorer.</div>
                )}
              </TabPanel>
              <TabPanel header="SQL" leftIcon="pi pi-terminal">
                <SqlConsole
                  conexaoId={selecionada.id}
                  somenteLeitura={selecionada.somenteLeitura}
                  toast={toast}
                />
              </TabPanel>
            </TabView>
          )}
        </main>
      </div>
    </div>
  );
}