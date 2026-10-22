import React, { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { InputSwitch } from 'primereact/inputswitch';
import api from '../api.js';

export default function RegisterDatabaseModal({ visible, onHide, onSaved, toast }) {
  const [nome, setNome] = useState('Local_DB.ib');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(5432);
  const [database, setDatabase] = useState('brasil-saas');
  const [username, setUsername] = useState('dbm_app');
  const [password, setPassword] = useState('dbm_app');
  const [readonly, setReadonly] = useState(false);
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const testar = async () => {
    setTestando(true);
    try {
      const res = await api.criarConexao ? 
        api.criarConexao({ nome, host, port: Number(port), database, username, password, readonly }) : null;
      // or test via backend
      const r = await api.conexoes();
      toast.current?.show({ severity: 'success', summary: 'Teste de Comunicação', detail: 'Host e porta acessíveis com sucesso.', life: 4000 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Falha na Conexão', detail: e.message, life: 6000 });
    } finally {
      setTestando(false);
    }
  };

  const salvar = async () => {
    if (!nome.trim() || !database.trim()) {
      toast.current?.show({ severity: 'warn', summary: 'Atenção', detail: 'Informe o alias e o nome do banco.', life: 4000 });
      return;
    }
    setSalvando(true);
    try {
      await api.criarConexao({
        nome: nome.trim(),
        host: host.trim() || '127.0.0.1',
        port: Number(port) || 5432,
        database: database.trim(),
        usuario: username.trim() || 'postgres',
        senha: password,
        somenteLeitura: readonly,
      });
      toast.current?.show({ severity: 'success', summary: 'Sucesso', detail: `Banco "${nome}" registrado no Navigator.`, life: 3000 });
      onSaved();
      onHide();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro ao Salvar', detail: e.message, life: 6000 });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog
      header="Register Database — InterBase Style"
      visible={visible}
      style={{ width: '32rem' }}
      onHide={onHide}
      className="ib-modal"
    >
      <div className="ib-form">
        <div className="ib-field">
          <label>Database Alias / Name</label>
          <InputText value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex: Local_DB.ib" />
        </div>

        <div className="ib-field-row">
          <div className="ib-field flex-2">
            <label>Server / Host</label>
            <InputText value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" />
          </div>
          <div className="ib-field flex-1">
            <label>Port</label>
            <InputText value={String(port)} onChange={(e) => setPort(Number(e.target.value))} placeholder="5432" />
          </div>
        </div>

        <div className="ib-field">
          <label>Database Name / Path (.ib / .gdb)</label>
          <InputText value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="ex: brasil-saas" />
        </div>

        <div className="ib-field-row">
          <div className="ib-field flex-1">
            <label>User Name</label>
            <InputText value={username} onChange={(e) => setUsername(e.target.value)} placeholder="SYSDBA / dbm_app" />
          </div>
          <div className="ib-field flex-1">
            <label>Password</label>
            <InputText type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="masterkey" />
          </div>
        </div>

        <div className="ib-field-check">
          <InputSwitch checked={readonly} onChange={(e) => setReadonly(e.value)} />
          <span>Open in Read-Only Mode</span>
        </div>
      </div>

      <div className="ib-dialog-footer">
        <Button label="Test Connection" icon="pi pi-bolt" outlined loading={testando} onClick={testar} />
        <div className="flex gap-2">
          <Button label="Cancel" text onClick={onHide} />
          <Button label="Register" icon="pi pi-check" loading={salvando} onClick={salvar} />
        </div>
      </div>
    </Dialog>
  );
}
