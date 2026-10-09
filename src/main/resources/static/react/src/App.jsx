import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toast } from 'primereact/toast';
import { TabView, TabPanel } from 'primereact/tabview';
import { Menubar } from 'primereact/menubar';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import api from './api.js';
import ConexoesPanel from './components/ConexoesPanel.jsx';
import Explorer from './components/Explorer.jsx';
import DataBrowser from './components/DataBrowser.jsx';
import StructureView from './components/StructureView.jsx';
import SqlConsole from './components/SqlConsole.jsx';
import BancosView from './components/BancosView.jsx';

export default function App() {
  const toast = useRef(null);
  const conexoesRef = useRef(null);
  const [sobre, setSobre] = useState(false);
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

  const abrirObjeto = (schema, tabela, tipo, indiceAba = 0) => {
    setObjeto({ schema, tabela, tipo });
    setAba(indiceAba);
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

  const desconectar = () => {
    setSelecionada(null);
    setObjeto(null);
  };

  const menu = useMemo(
    () => [
      {
        label: 'Conexões',
        icon: 'pi pi-link',
        items: [
          { label: 'Nova conexão', icon: 'pi pi-plus', command: () => conexoesRef.current?.nova() },
          { label: 'Atualizar lista', icon: 'pi pi-refresh', command: () => carregar() },
          { separator: true },
          { label: 'Testar conexão', icon: 'pi pi-bolt', disabled: !selecionada, command: () => conectar() },
          { label: 'Desconectar', icon: 'pi pi-sign-out', disabled: !selecionada, command: desconectar },
        ],
      },
      {
        label: 'Banco',
        icon: 'pi pi-database',
        disabled: !selecionada,
        items: [
          { label: 'Objetos (Explorer)', icon: 'pi pi-sitemap', command: () => setAba(0) },
          { label: 'Bancos e schemas', icon: 'pi pi-database', command: () => setAba(2) },
        ],
      },
      {
        label: 'Objeto',
        icon: 'pi pi-table',
        disabled: !objeto,
        items: [
          { label: 'Abrir dados', icon: 'pi pi-table', command: () => setAba(0) },
          { label: 'Ver estrutura', icon: 'pi pi-sitemap', command: () => setAba(1) },
        ],
      },
      {
        label: 'Ferramentas',
        icon: 'pi pi-wrench',
        disabled: !selecionada,
        items: [
          { label: 'Console SQL', icon: 'pi pi-terminal', command: () => setAba(3) },
          { label: 'Bancos e schemas', icon: 'pi pi-database', command: () => setAba(2) },
        ],
      },
      {
        label: 'Ajuda',
        icon: 'pi pi-question-circle',
        items: [{ label: 'Sobre o DBM', icon: 'pi pi-info-circle', command: () => setSobre(true) }],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selecionada, objeto, carregar],
  );

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

      <div className="menubar-dbm">
        <Menubar model={menu} />
      </div>

      <div className="corpo">
        <aside className="lateral">
          <ConexoesPanel
            ref={conexoesRef}
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
                  <StructureView
                    conexaoId={selecionada.id}
                    schema={objeto.schema}
                    tabela={objeto.tabela}
                    tipo={objeto.tipo}
                    toast={toast}
                  />
                ) : (
                  <div className="vazio-aba">Escolha uma tabela no Explorer.</div>
                )}
              </TabPanel>
              <TabPanel header="Bancos" leftIcon="pi pi-database">
                <BancosView
                  conexaoId={selecionada.id}
                  somenteLeitura={selecionada.somenteLeitura}
                  toast={toast}
                />
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

      <footer className="statusbar">
        <span className="st">
          <i className={'pi pi-circle-fill ' + (selecionada ? 'ligado' : 'desligado')} />
          {selecionada ? `Conectado — ${selecionada.nome}` : 'Desconectado'}
        </span>
        {selecionada && <span>{selecionada.driver}</span>}
        {selecionada && <span>{selecionada.somenteLeitura ? 'Somente leitura' : 'Leitura/escrita'}</span>}
        <span className="dir">{selecionada?.url || ''}</span>
      </footer>

      <Dialog
        header="Sobre o Astral Database Manager"
        visible={sobre}
        style={{ width: '28rem' }}
        onHide={() => setSobre(false)}
      >
        <p>
          <strong>Astral Database Manager</strong> — base web inspirada no IBConsole (Interbase/Firebird).
        </p>
        <ul>
          <li>Produto independente do Astral Platform / BrasilCloudERP.</li>
          <li>Spring Boot 3 · Java 21 · React 19 · PrimeReact 10.</li>
          <li>Versão 1.0.0-SNAPSHOT.</li>
        </ul>
        <div className="dialog-rodape">
          <div />
          <Button label="Fechar" text onClick={() => setSobre(false)} />
        </div>
      </Dialog>
    </div>
  );
}