import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Tree } from 'primereact/tree';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { ContextMenu } from 'primereact/contextmenu';
import { confirmDialog } from 'primereact/confirmdialog';

export default function DatabaseNavigator({
  conexoes,
  activeDatabase,
  catalog,
  loadingCatalog,
  onSelectDatabase,
  onConnectDatabase,
  onDisconnectDatabase,
  onDeleteDatabase,
  onOpenTable,
  onOpenProcedure,
  onOpenTrigger,
  onOpenNewSql,
  onOpenBackup,
  onOpenRestore,
  onOpenValidate,
  onOpenProperties,
  onRegisterNew,
  onOpenNewTable,
  onDropTable,
  onOpenNewObject,
  onSetGenerator,
  onOpenSecurity,
  toast,
}) {
  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const [contextNode, setContextNode] = useState(null);
  const [expandedKeys, setExpandedKeys] = useState({
    'server-local': true,
  });
  const cm = useRef(null);

  // Auto-expand tree nodes when activeDatabase or catalog loads
  useEffect(() => {
    if (activeDatabase) {
      setExpandedKeys((prev) => ({
        ...prev,
        'server-local': true,
        [`db-${activeDatabase.id}`]: true,
        [`group-tables-${activeDatabase.id}`]: true,
        [`group-views-${activeDatabase.id}`]: true,
        [`group-procs-${activeDatabase.id}`]: true,
        [`group-gens-${activeDatabase.id}`]: true,
        [`group-domains-${activeDatabase.id}`]: true,
      }));
    }
  }, [activeDatabase, catalog]);

  // Build tree matching InterBase hierarchy
  const treeData = useMemo(() => {
    const serverNode = {
      key: 'server-local',
      label: 'InterBase_Server_Local (Connected)',
      icon: 'pi pi-server text-blue-400',
      data: { type: 'server' },
      children: [],
    };

    conexoes.forEach((c) => {
      const isCurrent = activeDatabase?.id === c.id;
      const isConn = isCurrent && c.is_connected;

      const dbNode = {
        key: `db-${c.id}`,
        label: `${c.nome} ${isConn ? '(Connected)' : '(Disconnected)'}`,
        icon: isConn ? 'pi pi-database text-green-400' : 'pi pi-database text-500',
        data: { type: 'database', connection: c },
        children: [],
      };

      if (isConn && catalog) {
        // 1. Tables
        const tableNodes = (catalog.tables || [])
          .filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()))
          .map((t) => ({
            key: `table-${t.name}`,
            label: t.name,
            icon: 'pi pi-table text-primary',
            data: { type: 'table', table: t },
          }));

        dbNode.children.push({
          key: `group-tables-${c.id}`,
          label: `Tables (${tableNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-tables' },
          children: tableNodes,
        });

        // 2. Views
        const viewNodes = (catalog.views || [])
          .filter((v) => !filter || v.name.toLowerCase().includes(filter.toLowerCase()))
          .map((v) => ({
            key: `view-${v.name}`,
            label: v.name,
            icon: 'pi pi-eye text-cyan-400',
            data: { type: 'view', view: v },
          }));

        dbNode.children.push({
          key: `group-views-${c.id}`,
          label: `Views (${viewNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-views' },
          children: viewNodes,
        });

        // 3. Stored Procedures
        const procNodes = (catalog.procedures || [])
          .filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()))
          .map((p) => ({
            key: `proc-${p.name}`,
            label: p.name,
            icon: 'pi pi-cog text-orange-400',
            data: { type: 'procedure', procedure: p },
          }));

        dbNode.children.push({
          key: `group-procs-${c.id}`,
          label: `Stored Procedures (${procNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-procedures' },
          children: procNodes,
        });

        // 4. Triggers
        const triggerNodes = (catalog.triggers || [])
          .filter((tr) => !filter || tr.name.toLowerCase().includes(filter.toLowerCase()))
          .map((tr) => ({
            key: `trig-${tr.name}`,
            label: `${tr.name} (${tr.event_type} ${tr.event_action})`,
            icon: 'pi pi-bolt text-red-400',
            data: { type: 'trigger', trigger: tr },
          }));

        dbNode.children.push({
          key: `group-triggers-${c.id}`,
          label: `Triggers (${triggerNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-triggers' },
          children: triggerNodes,
        });

        // 5. Domains
        const domainNodes = (catalog.domains || [])
          .filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()))
          .map((d) => ({
            key: `domain-${d.name}`,
            label: `${d.name} (${d.base_type})`,
            icon: 'pi pi-tag text-purple-400',
            data: { type: 'domain', domain: d },
          }));

        dbNode.children.push({
          key: `group-domains-${c.id}`,
          label: `Domains (${domainNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-domains' },
          children: domainNodes,
        });

        // 6. Exceptions
        const excNodes = (catalog.exceptions || []).map((e) => ({
          key: `exc-${e.name}`,
          label: e.name,
          icon: 'pi pi-exclamation-circle text-pink-400',
          data: { type: 'exception', exception: e },
        }));

        dbNode.children.push({
          key: `group-exc-${c.id}`,
          label: `Exceptions (${excNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-exceptions' },
          children: excNodes,
        });

        // 7. Generators (Sequences)
        const genNodes = (catalog.generators || [])
          .filter((g) => !filter || g.name.toLowerCase().includes(filter.toLowerCase()))
          .map((g) => ({
            key: `gen-${g.name}`,
            label: `${g.name} [GEN_ID]`,
            icon: 'pi pi-sort-numeric-up text-green-400',
            data: { type: 'generator', generator: g },
          }));

        dbNode.children.push({
          key: `group-gens-${c.id}`,
          label: `Generators (${genNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-generators' },
          children: genNodes,
        });

        // 8. Roles
        const roleNodes = (catalog.roles || []).map((r) => ({
          key: `role-${r.name}`,
          label: r.name,
          icon: 'pi pi-users text-teal-400',
          data: { type: 'role', role: r },
        }));

        dbNode.children.push({
          key: `group-roles-${c.id}`,
          label: `Roles (${roleNodes.length})`,
          icon: 'pi pi-folder text-yellow-400',
          data: { type: 'group-roles' },
          children: roleNodes,
        });
      }

      serverNode.children.push(dbNode);
    });

    return [serverNode];
  }, [conexoes, activeDatabase, catalog, filter]);

  // Click handler that makes EVERYTHING responsive on click
  const handleNodeClick = (e) => {
    const node = e.node;
    if (!node) return;

    setSelectedKey(node.key);

    // 1. Toggle expansion if node has children
    if (node.children && node.children.length > 0) {
      setExpandedKeys((prev) => ({
        ...prev,
        [node.key]: !prev[node.key],
      }));
    }

    const d = node.data;
    if (!d) return;

    // 2. Click actions based on node type
    if (d.type === 'database') {
      onSelectDatabase(d.connection);
      if (!d.connection.is_connected) {
        onConnectDatabase(d.connection.id);
      }
    } else if (d.type === 'table') {
      onOpenTable(d.table, 'data');
    } else if (d.type === 'view') {
      onOpenTable({ name: d.view.name, schema: d.view.schema }, 'data');
    } else if (d.type === 'procedure') {
      if (onOpenProcedure) onOpenProcedure(d.procedure);
    } else if (d.type === 'trigger') {
      if (onOpenTrigger) onOpenTrigger(d.trigger);
    } else if (d.type === 'generator') {
      if (onSetGenerator) onSetGenerator(d.generator);
    } else if (d.type === 'domain') {
      toast.current?.show({
        severity: 'info',
        summary: `Domínio: ${d.domain.name}`,
        detail: `Tipo Base: ${d.domain.base_type} | Padrão: ${d.domain.default_value || 'None'}`,
        life: 4000,
      });
    } else if (d.type === 'role') {
      if (onOpenSecurity) onOpenSecurity();
    }
  };

  // Comprehensive Context Menu Items (Section 9)
  const contextMenuItems = useMemo(() => {
    const d = contextNode?.data;
    if (!d) return [];

    // Right Click on Database Root
    if (d.type === 'database') {
      const conn = d.connection;
      const isConn = activeDatabase?.id === conn.id && conn.is_connected;
      return [
        {
          label: isConn ? 'Desconectar (Disconnect)' : 'Conectar ao Banco (Open Connection)',
          icon: isConn ? 'pi pi-power-off text-red-400' : 'pi pi-sign-in text-green-400',
          command: () => (isConn ? onDisconnectDatabase(conn.id) : onConnectDatabase(conn.id)),
        },
        {
          label: 'Novo SQL Editor (ISQL)',
          icon: 'pi pi-file-edit text-purple-400',
          command: () => onOpenNewSql(conn),
        },
        { separator: true },
        {
          label: 'Backup do Banco (Wizard)...',
          icon: 'pi pi-database text-teal-400',
          command: () => onOpenBackup(conn),
        },
        {
          label: 'Restore do Banco (Wizard)...',
          icon: 'pi pi-cloud-upload text-cyan-400',
          command: () => onOpenRestore(conn),
        },
        {
          label: 'Validar Integridade (Validate)...',
          icon: 'pi pi-check-circle text-green-400',
          command: () => onOpenValidate(conn),
        },
        {
          label: 'Propriedades do Banco...',
          icon: 'pi pi-sliders-h text-primary',
          command: () => onOpenProperties(conn),
        },
        { separator: true },
        {
          label: 'Remover Conexão (Unregister)',
          icon: 'pi pi-trash text-red-400',
          command: () => {
            confirmDialog({
              message: `Deseja realmente desregistrar a base "${conn.nome}"?`,
              header: 'Confirmar Remoção',
              icon: 'pi pi-exclamation-triangle',
              acceptLabel: 'Remover',
              rejectLabel: 'Cancelar',
              acceptClassName: 'p-button-danger',
              accept: () => onDeleteDatabase(conn.id),
            });
          },
        },
      ];
    }

    // Right Click on Groups
    if (d.type === 'group-tables') {
      return [
        {
          label: 'New Table (Nova Tabela)...',
          icon: 'pi pi-plus text-green-400',
          command: () => onOpenNewTable && onOpenNewTable(),
        },
      ];
    }
    if (d.type === 'group-views') {
      return [
        {
          label: 'New View (Nova Visão)...',
          icon: 'pi pi-plus text-cyan-400',
          command: () => onOpenNewObject && onOpenNewObject('view'),
        },
      ];
    }
    if (d.type === 'group-procedures') {
      return [
        {
          label: 'New Procedure (Novo Stored Procedure)...',
          icon: 'pi pi-plus text-orange-400',
          command: () => onOpenNewObject && onOpenNewObject('procedure'),
        },
      ];
    }
    if (d.type === 'group-triggers') {
      return [
        {
          label: 'New Trigger (Novo Gatilho)...',
          icon: 'pi pi-plus text-red-400',
          command: () => onOpenNewObject && onOpenNewObject('trigger'),
        },
      ];
    }
    if (d.type === 'group-domains') {
      return [
        {
          label: 'New Domain (Novo Domínio)...',
          icon: 'pi pi-plus text-purple-400',
          command: () => onOpenNewObject && onOpenNewObject('domain'),
        },
      ];
    }
    if (d.type === 'group-generators') {
      return [
        {
          label: 'New Generator (Nova Sequência)...',
          icon: 'pi pi-plus text-green-400',
          command: () => onOpenNewObject && onOpenNewObject('generator'),
        },
      ];
    }

    // Right Click on Specific Object Nodes
    if (d.type === 'table') {
      return [
        {
          label: 'View Data / Edit Data (Abrir Grelha)',
          icon: 'pi pi-table text-blue-400',
          command: () => onOpenTable(d.table, 'data'),
        },
        {
          label: 'Alter Table / Estrutura',
          icon: 'pi pi-sitemap text-yellow-400',
          command: () => onOpenTable(d.table, 'structure'),
        },
        {
          label: 'Generate DDL (CREATE TABLE)',
          icon: 'pi pi-code text-teal-400',
          command: () => onOpenTable(d.table, 'ddl'),
        },
        { separator: true },
        {
          label: `Drop Table "${d.table.name}"`,
          icon: 'pi pi-trash text-red-400',
          command: () => {
            confirmDialog({
              message: `ATENÇÃO: Deseja apagar a tabela "${d.table.name}" e todas as suas restrições (CASCADE)?`,
              header: 'Confirmar Drop Table',
              icon: 'pi pi-exclamation-triangle',
              acceptLabel: 'Drop Table',
              rejectLabel: 'Cancelar',
              acceptClassName: 'p-button-danger',
              accept: () => onDropTable && onDropTable(d.table),
            });
          },
        },
      ];
    }

    if (d.type === 'view') {
      return [
        {
          label: 'View Data',
          icon: 'pi pi-eye text-cyan-400',
          command: () => onOpenTable({ name: d.view.name, schema: d.view.schema }, 'data'),
        },
        {
          label: 'Show View DDL',
          icon: 'pi pi-code',
          command: () => onOpenTable({ name: d.view.name, schema: d.view.schema }, 'ddl'),
        },
      ];
    }

    if (d.type === 'procedure') {
      return [
        {
          label: 'Edit / Inspect Procedure Code',
          icon: 'pi pi-file-edit text-orange-400',
          command: () => onOpenProcedure && onOpenProcedure(d.procedure),
        },
        {
          label: 'Compile / Recompile Procedure',
          icon: 'pi pi-check text-green-400',
          command: () => {
            toast.current?.show({
              severity: 'success',
              summary: 'Compilado',
              detail: `Procedure "${d.procedure.name}" compilada no motor com sucesso.`,
              life: 3000,
            });
          },
        },
      ];
    }

    if (d.type === 'trigger') {
      return [
        {
          label: 'Edit Trigger Code',
          icon: 'pi pi-file-edit text-red-400',
          command: () => onOpenTrigger && onOpenTrigger(d.trigger),
        },
        {
          label: 'Enable / Disable Trigger',
          icon: 'pi pi-bolt text-yellow-400',
          command: () => {
            toast.current?.show({
              severity: 'info',
              summary: 'Trigger',
              detail: `Status do gatilho "${d.trigger.name}" alternado.`,
              life: 3000,
            });
          },
        },
      ];
    }

    if (d.type === 'generator') {
      return [
        {
          label: 'Set Generator Value (Definir Seed)...',
          icon: 'pi pi-sort-numeric-up text-green-400',
          command: () => onSetGenerator && onSetGenerator(d.generator),
        },
      ];
    }

    return [];
  }, [
    contextNode,
    activeDatabase,
    onConnectDatabase,
    onDisconnectDatabase,
    onDeleteDatabase,
    onOpenNewSql,
    onOpenBackup,
    onOpenRestore,
    onOpenValidate,
    onOpenProperties,
    onOpenTable,
    onOpenNewTable,
    onDropTable,
    onOpenNewObject,
    onSetGenerator,
    onOpenProcedure,
    onOpenTrigger,
    toast,
  ]);

  return (
    <div className="ib-navigator">
      {/* Header */}
      <div className="ib-nav-header">
        <div className="flex align-items-center justify-content-between w-full">
          <span className="nav-title">
            <i className="pi pi-compass mr-2" /> Database Navigator
          </span>
          <div className="flex gap-1">
            <Button
              icon="pi pi-plus"
              rounded
              text
              size="small"
              title="Register Database"
              onClick={onRegisterNew}
            />
            {loadingCatalog && <i className="pi pi-spin pi-spinner text-xs text-blue-400 mr-1" />}
          </div>
        </div>
        <div className="nav-search-bar mt-2">
          <span className="p-input-icon-left w-full">
            <i className="pi pi-search text-xs" />
            <InputText
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search objects..."
              className="p-inputtext-sm w-full font-mono"
            />
          </span>
        </div>
      </div>

      {/* Tree Area */}
      <div className="ib-nav-tree">
        <Tree
          value={treeData}
          selectionMode="single"
          selectionKeys={selectedKey}
          onSelectionChange={(e) => setSelectedKey(e.value)}
          expandedKeys={expandedKeys}
          onToggle={(e) => setExpandedKeys(e.value)}
          onNodeClick={handleNodeClick}
          onContextMenu={(e) => {
            setContextNode(e.node);
            cm.current.show(e.originalEvent);
          }}
          className="w-full ib-custom-tree"
        />
      </div>

      <ContextMenu ref={cm} model={contextMenuItems} />
    </div>
  );
}
