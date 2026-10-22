import React, { useEffect, useImperativeHandle, useState } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import api from '../api.js';

const VAZIO = {
  nome: '',
  driverId: null,
  url: '',
  usuario: '',
  senha: '',
  esquemaPadrao: '',
  grupoId: null,
  global: false,
  somenteLeitura: false,
  timeoutMs: 30000,
};

const ConexoesPanel = React.forwardRef(function ConexoesPanel(
  { conexoes, drivers, grupos, selecionada, onSelecionar, onMudou, toast },
  ref,
) {
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setEditandoId(form.id || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const abrirNova = () => {
    setForm(VAZIO);
    setEditandoId(null);
    setAberto(true);
  };

  const abrirEdicao = (c) => {
    setForm({ ...VAZIO, ...c, senha: '' });
    setEditandoId(c.id);
    setAberto(true);
  };

  useImperativeHandle(ref, () => ({ nova: abrirNova }));

  const testar = async () => {
    setTestando(true);
    try {
      const r = await api.testarConexao(editandoId);
      toast.current?.show({ severity: 'success', summary: 'Conectou', detail: r.versao, life: 4000 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Falha', detail: e.message, life: 6000 });
    } finally {
      setTestando(false);
    }
  };

  const salvar = async () => {
    if (!form.nome || !form.driverId || !form.url) {
      toast.current?.show({ severity: 'warn', summary: 'Campos obrigatórios', detail: 'Nome, driver e URL.', life: 4000 });
      return;
    }
    try {
      if (editandoId) {
        await api.atualizarConexao(editandoId, form);
      } else {
        await api.criarConexao(form);
      }
      toast.current?.show({ severity: 'success', summary: 'Salvo', life: 2500 });
      setAberto(false);
      onMudou();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 6000 });
    }
  };

  const remover = (c) => {
    confirmDialog({
      message: `Remover a conexão "${c.nome}"?`,
      header: 'Confirmar',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Remover',
      rejectLabel: 'Cancelar',
      accept: async () => {
        try {
          await api.removerConexao(c.id);
          onMudou();
        } catch (e) {
          toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 6000 });
        }
      },
    });
  };

  const acoes = (c) => (
    <div className="flex gap-1">
      <Button icon="pi pi-sign-in" rounded text onClick={() => onSelecionar(c)} tooltip="Conectar" />
      <Button icon="pi pi-pencil" rounded text onClick={() => abrirEdicao(c)} tooltip="Editar" />
      <Button icon="pi pi-trash" rounded text severity="danger" onClick={() => remover(c)} tooltip="Remover" />
    </div>
  );

  const estado = (c) =>
    c.somenteLeitura ? <Tag value="Somente leitura" severity="warning" /> : <Tag value="Escrita" severity="success" />;

  return (
    <div className="conexoes-panel">
      <div className="painel-titulo">
        <span>Conexões</span>
        <Button icon="pi pi-plus" rounded text onClick={abrirNova} tooltip="Nova conexão" />
      </div>
      <DataTable
        value={conexoes}
        selectionMode="single"
        selection={selecionada}
        onSelectionChange={(e) => e.value && onSelecionar(e.value)}
        size="small"
        scrollable
        scrollHeight="flex"
        emptyMessage="Nenhuma conexão. Crie a primeira."
      >
        <Column field="nome" header="Nome" />
        <Column field="driver" header="Driver" />
        <Column header="Modo" body={estado} style={{ width: '8rem' }} />
        <Column body={acoes} style={{ width: '8rem' }} />
      </DataTable>

      <Dialog
        header={editandoId ? 'Editar conexão' : 'Nova conexão'}
        visible={aberto}
        style={{ width: '34rem' }}
        onHide={() => setAberto(false)}
      >
        <div className="form-grid">
          <label>Nome</label>
          <InputText value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />

          <label>Driver</label>
          <Dropdown
            value={form.driverId}
            options={drivers.map((d) => ({ label: `${d.fabricante} ${d.versao} — ${d.nome}`, value: d.id }))}
            onChange={(e) => {
              const d = drivers.find((x) => x.id === e.value);
              setForm({ ...form, driverId: e.value, url: form.url || d?.jdbcUrlTemplate || '' });
            }}
            placeholder="Selecione o driver"
          />

          <label>URL JDBC</label>
          <InputText value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="jdbc:postgresql://host:5432/banco" />

          <label>Usuário do banco</label>
          <InputText value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />

          <label>Senha</label>
          <InputText type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} placeholder={editandoId ? '(manter)' : ''} />

          <label>Schema padrão</label>
          <InputText value={form.esquemaPadrao} onChange={(e) => setForm({ ...form, esquemaPadrao: e.target.value })} placeholder="public" />

          <label>Grupo</label>
          <Dropdown
            value={form.grupoId}
            options={grupos.map((g) => ({ label: g.nome, value: g.id }))}
            onChange={(e) => setForm({ ...form, grupoId: e.value })}
            showClear
            placeholder="(sem grupo)"
          />

          <label>Timeout (ms)</label>
          <InputNumber value={form.timeoutMs} onValueChange={(e) => setForm({ ...form, timeoutMs: e.value || 30000 })} min={1000} step={1000} />

          <label>Somente leitura</label>
          <InputSwitch checked={form.somenteLeitura} onChange={(e) => setForm({ ...form, somenteLeitura: e.value })} />

          <label>Global</label>
          <InputSwitch checked={form.global} onChange={(e) => setForm({ ...form, global: e.value })} />
        </div>

        <div className="dialog-rodape">
          <Button label="Testar" icon="pi pi-bolt" outlined loading={testando} disabled={!editandoId} onClick={testar} />
          <div className="flex gap-2">
            <Button label="Cancelar" text onClick={() => setAberto(false)} />
            <Button label="Salvar" icon="pi pi-check" onClick={salvar} />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
});

export default ConexoesPanel;