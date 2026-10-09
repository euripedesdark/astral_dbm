import React, { useCallback, useEffect, useState } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Message } from 'primereact/message';
import api from '../api.js';

const ENCODINGS = [
  { label: 'UTF8', value: 'UTF8' },
  { label: 'LATIN1', value: 'LATIN1' },
  { label: 'WIN1252', value: 'WIN1252' },
  { label: 'SQL_ASCII', value: 'SQL_ASCII' },
];

export default function BancosView({ conexaoId, somenteLeitura, toast }) {
  const [bancos, setBancos] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [carregando, setCarregando] = useState(false);

  const [novoBanco, setNovoBanco] = useState(null);
  const [previa, setPrevia] = useState('');
  const [dropBanco, setDropBanco] = useState(null);
  const [novoSchema, setNovoSchema] = useState(null);
  const [dropSchema, setDropSchema] = useState(null);

  const carregar = useCallback(async () => {
    if (!conexaoId) {
      return;
    }
    setCarregando(true);
    try {
      const [bs, ss] = await Promise.all([api.bancos(conexaoId), api.schemas(conexaoId)]);
      setBancos(bs);
      setSchemas(ss);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Bancos', detail: e.message, life: 6000 });
    } finally {
      setCarregando(false);
    }
  }, [conexaoId, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const abrirNovoBanco = () => {
    setPrevia('');
    setNovoBanco({ nome: '', dono: '', encoding: 'UTF8', template: '', confirmar: false });
  };

  const verPrevia = async () => {
    try {
      const r = await api.preverBanco(conexaoId, novoBanco);
      setPrevia(r.sql);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Pré-visualizar', detail: e.message, life: 6000 });
    }
  };

  const criarBanco = async () => {
    try {
      await api.criarBanco(conexaoId, novoBanco);
      toast.current?.show({ severity: 'success', summary: `Banco ${novoBanco.nome} criado`, life: 3000 });
      setNovoBanco(null);
      carregar();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 8000 });
    }
  };

  const confirmarDropBanco = async () => {
    try {
      await api.droparBanco(conexaoId, dropBanco.nome, dropBanco.confirmacao, dropBanco.forcar);
      toast.current?.show({ severity: 'success', summary: `Banco ${dropBanco.nome} removido`, life: 3000 });
      setDropBanco(null);
      carregar();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 8000 });
    }
  };

  const criarSchema = async () => {
    try {
      await api.criarSchema(conexaoId, novoSchema.nome, true);
      toast.current?.show({ severity: 'success', summary: `Schema ${novoSchema.nome} criado`, life: 2500 });
      setNovoSchema(null);
      carregar();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 6000 });
    }
  };

  const droparSchema = async () => {
    try {
      await api.droparSchema(conexaoId, dropSchema.nome, dropSchema.confirmacao, dropSchema.cascade);
      toast.current?.show({ severity: 'success', summary: `Schema ${dropSchema.nome} removido`, life: 2500 });
      setDropSchema(null);
      carregar();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 6000 });
    }
  };

  const acoesBanco = (b) => (
    <Button
      icon="pi pi-trash"
      rounded
      text
      severity="danger"
      tooltip="Drop database"
      disabled={somenteLeitura}
      onClick={() => setDropBanco({ nome: b.nome, confirmacao: '', forcar: true })}
    />
  );

  const acoesSchema = (s) => (
    <Button
      icon="pi pi-trash"
      rounded
      text
      severity="danger"
      tooltip="Drop schema"
      disabled={somenteLeitura}
      onClick={() => setDropSchema({ nome: s.nome, confirmacao: '', cascade: false })}
    />
  );

  return (
    <div className="bancos">
      <div className="barra">
        <span className="alvo">
          <i className="pi pi-server" /> Bancos e schemas do servidor
          {somenteLeitura && <span className="aviso-ro">somente leitura</span>}
        </span>
        <Button label="Atualizar" icon="pi pi-refresh" text onClick={carregar} loading={carregando} />
      </div>

      <div className="bancos-colunas">
        <section className="cartao">
          <div className="painel-titulo">
            <span>
              <i className="pi pi-database" /> Bancos ({bancos.length})
            </span>
            <Button icon="pi pi-plus" rounded text tooltip="Criar banco" disabled={somenteLeitura} onClick={abrirNovoBanco} />
          </div>
          <DataTable
            value={bancos}
            size="small"
            scrollable
            scrollHeight="flex"
            dataKey="nome"
            emptyMessage="Nenhum banco"
          >
            <Column field="nome" header="Banco" />
            <Column field="dono" header="Dono" />
            <Column field="codificacao" header="Codificação" />
            <Column header="Conexões" body={(r) => (r.limite_conexao === -1 ? '∞' : r.limite_conexao)} />
            <Column field="tamanho" header="Tamanho" />
            <Column body={acoesBanco} style={{ width: '4rem' }} />
          </DataTable>
        </section>

        <section className="cartao">
          <div className="painel-titulo">
            <span>
              <i className="pi pi-sitemap" /> Schemas ({schemas.length})
            </span>
            <Button
              icon="pi pi-plus"
              rounded
              text
              tooltip="Criar schema"
              disabled={somenteLeitura}
              onClick={() => setNovoSchema({ nome: '' })}
            />
          </div>
          <DataTable
            value={schemas.map((s) => ({ nome: s }))}
            size="small"
            scrollable
            scrollHeight="flex"
            dataKey="nome"
            emptyMessage="Nenhum schema"
          >
            <Column field="nome" header="Schema" />
            <Column body={acoesSchema} style={{ width: '4rem' }} />
          </DataTable>
        </section>
      </div>

      <Dialog header="Criar banco" visible={!!novoBanco} style={{ width: '34rem' }} onHide={() => setNovoBanco(null)}>
        {novoBanco && (
          <>
            <div className="form-grid">
              <label>Nome *</label>
              <InputText value={novoBanco.nome} onChange={(e) => setNovoBanco({ ...novoBanco, nome: e.target.value })} />
              <label>Dono</label>
              <InputText
                value={novoBanco.dono}
                onChange={(e) => setNovoBanco({ ...novoBanco, dono: e.target.value })}
                placeholder="(padrão: usuário da conexão)"
              />
              <label>Codificação</label>
              <Dropdown
                value={novoBanco.encoding}
                options={ENCODINGS}
                onChange={(e) => setNovoBanco({ ...novoBanco, encoding: e.value })}
              />
              <label>Template</label>
              <InputText
                value={novoBanco.template}
                onChange={(e) => setNovoBanco({ ...novoBanco, template: e.target.value })}
                placeholder="template1"
              />
            </div>
            {previa && <pre className="sql-previa">{previa}</pre>}
            <div className="dialog-rodape">
              <Button
                label="Pré-visualizar SQL"
                icon="pi pi-code"
                outlined
                disabled={!novoBanco.nome}
                onClick={verPrevia}
              />
              <div className="flex gap-2 align-items-center">
                <span className="flex align-items-center gap-2">
                  <Checkbox
                    inputId="conf-banco"
                    checked={novoBanco.confirmar}
                    onChange={(e) => setNovoBanco({ ...novoBanco, confirmar: e.checked })}
                  />
                  <label htmlFor="conf-banco">Confirmo a criação</label>
                </span>
                <Button label="Cancelar" text onClick={() => setNovoBanco(null)} />
                <Button
                  label="Criar"
                  icon="pi pi-check"
                  disabled={!novoBanco.confirmar || !novoBanco.nome}
                  onClick={criarBanco}
                />
              </div>
            </div>
          </>
        )}
      </Dialog>

      <Dialog header="Drop database" visible={!!dropBanco} style={{ width: '30rem' }} onHide={() => setDropBanco(null)}>
        {dropBanco && (
          <>
            <Message
              severity="error"
              className="w-full mb-3"
              text="Operação irreversível. A spec (§4.1) exige backup verificado recente."
            />
            <p>
              Para confirmar, digite o nome do banco: <strong>{dropBanco.nome}</strong>
            </p>
            <InputText
              className="w-full"
              value={dropBanco.confirmacao}
              onChange={(e) => setDropBanco({ ...dropBanco, confirmacao: e.target.value })}
            />
            <div className="flex align-items-center gap-2 mt-3">
              <Checkbox
                inputId="forcar-banco"
                checked={dropBanco.forcar}
                onChange={(e) => setDropBanco({ ...dropBanco, forcar: e.checked })}
              />
              <label htmlFor="forcar-banco">Encerrar conexões ativas (pg_terminate_backend)</label>
            </div>
            <div className="dialog-rodape">
              <div />
              <div className="flex gap-2">
                <Button label="Cancelar" text onClick={() => setDropBanco(null)} />
                <Button
                  label="Drop database"
                  icon="pi pi-trash"
                  severity="danger"
                  disabled={dropBanco.confirmacao !== dropBanco.nome}
                  onClick={confirmarDropBanco}
                />
              </div>
            </div>
          </>
        )}
      </Dialog>

      <Dialog header="Criar schema" visible={!!novoSchema} style={{ width: '26rem' }} onHide={() => setNovoSchema(null)}>
        {novoSchema && (
          <>
            <div className="form-grid">
              <label>Nome *</label>
              <InputText value={novoSchema.nome} onChange={(e) => setNovoSchema({ nome: e.target.value })} />
            </div>
            <div className="dialog-rodape">
              <div />
              <div className="flex gap-2">
                <Button label="Cancelar" text onClick={() => setNovoSchema(null)} />
                <Button label="Criar" icon="pi pi-check" disabled={!novoSchema.nome} onClick={criarSchema} />
              </div>
            </div>
          </>
        )}
      </Dialog>

      <Dialog header="Drop schema" visible={!!dropSchema} style={{ width: '28rem' }} onHide={() => setDropSchema(null)}>
        {dropSchema && (
          <>
            <p>
              Digite o nome do schema para confirmar: <strong>{dropSchema.nome}</strong>
            </p>
            <InputText
              className="w-full"
              value={dropSchema.confirmacao}
              onChange={(e) => setDropSchema({ ...dropSchema, confirmacao: e.target.value })}
            />
            <div className="flex align-items-center gap-2 mt-3">
              <Checkbox
                inputId="cascade-schema"
                checked={dropSchema.cascade}
                onChange={(e) => setDropSchema({ ...dropSchema, cascade: e.checked })}
              />
              <label htmlFor="cascade-schema">CASCADE (remove objetos contidos)</label>
            </div>
            <div className="dialog-rodape">
              <div />
              <div className="flex gap-2">
                <Button label="Cancelar" text onClick={() => setDropSchema(null)} />
                <Button
                  label="Drop schema"
                  icon="pi pi-trash"
                  severity="danger"
                  disabled={dropSchema.confirmacao !== dropSchema.nome}
                  onClick={droparSchema}
                />
              </div>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
