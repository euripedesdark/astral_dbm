import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TabView, TabPanel } from 'primereact/tabview';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { ContextMenu } from 'primereact/contextmenu';
import api from '../api.js';

export default function TableViewer({ activeDatabase, table, initialSubTab = 3, toast }) {
  const [subTab, setSubTab] = useState(initialSubTab);
  const [dataRows, setDataRows] = useState([]);
  const [dataColumns, setDataColumns] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [ddlText, setDdlText] = useState('');
  const [structure, setStructure] = useState({
    colunas: table?.columns || [],
    restricoes: table?.constraints || [],
    indices: table?.indices || [],
  });

  // Settings
  const [autoSave, setAutoSave] = useState(true);

  // Selection & In-Place Editing State
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [editingCell, setEditingCell] = useState(null); // { rowKey, column }
  const [editingValue, setEditingValue] = useState('');
  const [dirtyRows, setDirtyRows] = useState({}); // { [rowKey]: { original, modified: {}, isNew: bool } }
  const [saving, setSaving] = useState(false);
  const [savingCellKey, setSavingCellKey] = useState(null);
  const [contextRow, setContextRow] = useState(null);
  const [contextCol, setContextCol] = useState(null);

  // Record Form View Modal (IBExpert Style)
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordModalMode, setRecordModalMode] = useState('edit'); // 'edit' | 'insert'
  const [recordFormData, setRecordFormData] = useState({});
  const [recordFormNulls, setRecordFormNulls] = useState({});
  const [recordModalRowIndex, setRecordModalRowIndex] = useState(0);
  const [recordSaving, setRecordSaving] = useState(false);

  const cm = useRef(null);
  const cellInputRef = useRef(null);

  // Sync subTab if initialSubTab prop changes
  useEffect(() => {
    if (initialSubTab !== undefined) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const schemaName = table?.schema || 'public';
  const tableName = table?.name || '';

  // Fetch structure if missing
  useEffect(() => {
    if (!table?.columns || table.columns.length === 0) {
      if (activeDatabase && table) {
        api.estrutura(activeDatabase.id, schemaName, tableName)
          .then((res) => {
            if (res) {
              setStructure({
                colunas: res.colunas || [],
                restricoes: res.restricoes || [],
                indices: res.indices || [],
              });
            }
          })
          .catch(() => {});
      }
    } else {
      setStructure({
        colunas: table.columns || [],
        restricoes: table.constraints || [],
        indices: table.indices || [],
      });
    }
  }, [table, activeDatabase, schemaName, tableName]);

  // Fetch Live Table Data
  const loadData = useCallback(async (p = 1) => {
    if (!activeDatabase || !table) return;
    setLoadingData(true);
    try {
      const res = await api.dados(activeDatabase.id, schemaName, tableName, p, 50, search);
      setDataColumns(res.columns || []);
      const mapped = (res.rows || []).map((r, i) => {
        const item = {
          __rowNum: (p - 1) * 50 + i + 1,
          __rowKey: `row_${(p - 1) * 50 + i + 1}`,
          __editingCol: null,
        };
        (res.columns || []).forEach((c, idx) => {
          const v = r[idx];
          item[c] = v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        });
        return item;
      });
      setDataRows(mapped);
      setTotalRows(res.total_rows || 0);
      setPage(p);
      setDirtyRows({});
      setEditingCell(null);
      setSelectedRowIndex(0);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Dados', detail: e.message, life: 5000 });
    } finally {
      setLoadingData(false);
    }
  }, [activeDatabase, table, schemaName, tableName, search, toast]);

  // Fetch DDL
  const loadDdl = useCallback(async () => {
    if (!activeDatabase || !table) return;
    try {
      const res = await api.ddl(activeDatabase.id, schemaName, tableName, 'tabela', tableName);
      setDdlText(res.ddl || '');
    } catch (e) {
      setDdlText(`-- Erro ao carregar DDL: ${e.message}`);
    }
  }, [activeDatabase, table, schemaName, tableName]);

  useEffect(() => {
    if (subTab === 3) {
      loadData(1);
    } else if (subTab === 4) {
      loadDdl();
    }
  }, [subTab, loadData, loadDdl]);

  // Auto focus input on mount
  useEffect(() => {
    if (editingCell && cellInputRef.current) {
      cellInputRef.current.focus();
      cellInputRef.current.select();
    }
  }, [editingCell]);

  // Find Primary Key Columns
  const getPkColumns = useCallback(() => {
    const pks = (structure.colunas || []).filter((c) => c.is_primary_key).map((c) => c.name);
    if (pks.length > 0) return pks;
    if (dataColumns.includes('id')) return ['id'];
    return dataColumns;
  }, [structure.colunas, dataColumns]);

  // --- SAVE ROW DIRECTLY ---
  const saveSingleRow = async (rowKey, modifiedFields, originalRow, isNew = false) => {
    if (!activeDatabase || !table) return;
    const pkCols = getPkColumns();
    const keys = {};
    pkCols.forEach((pk) => {
      keys[pk] = originalRow[pk];
    });

    const valuesToSave = {};
    if (isNew) {
      dataColumns.forEach((c) => {
        const v = modifiedFields[c] !== undefined ? modifiedFields[c] : originalRow[c];
        if (v !== 'NULL' && v !== undefined && v !== '') {
          valuesToSave[c] = v;
        }
      });
    } else {
      Object.entries(modifiedFields).forEach(([col, val]) => {
        valuesToSave[col] = val === 'NULL' ? null : val;
      });
    }

    setSavingCellKey(rowKey);
    try {
      const res = await api.salvarLinha(
        activeDatabase.id,
        schemaName,
        tableName,
        isNew ? 'insert' : 'update',
        keys,
        valuesToSave
      );

      setDirtyRows((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });

      if (res && typeof res === 'object') {
        setDataRows((prev) =>
          prev.map((r) => {
            if (r.__rowKey === rowKey) {
              const updated = { ...r, ...modifiedFields, __isNew: false };
              Object.entries(res).forEach(([k, v]) => {
                if (dataColumns.includes(k)) {
                  updated[k] = v === null || v === undefined ? 'NULL' : String(v);
                }
              });
              return updated;
            }
            return r;
          })
        );
      }

      toast.current?.show({
        severity: 'success',
        summary: 'Salvo (✓)',
        detail: `Registro #${originalRow.__rowNum || ''} gravado com sucesso.`,
        life: 2000,
      });
      return true;
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Salvar',
        detail: e.message,
        life: 5000,
      });
      return false;
    } finally {
      setSavingCellKey(null);
    }
  };

  // --- IN-LINE CELL EDITING ---
  const startCellEdit = (row, column) => {
    const rowKey = row.__rowKey;
    const currentVal = dirtyRows[rowKey]?.modified?.[column] !== undefined
      ? dirtyRows[rowKey].modified[column]
      : row[column];
    setEditingCell({ rowKey, column });
    setEditingValue(currentVal === 'NULL' ? '' : currentVal);

    // Force row update in dataRows to trigger exact row re-render
    setDataRows((prev) =>
      prev.map((r) =>
        r.__rowKey === rowKey
          ? { ...r, __editingCol: column }
          : r.__editingCol
          ? { ...r, __editingCol: null }
          : r
      )
    );
  };

  const commitCellEdit = async (advanceNext = false, advancePrev = false) => {
    if (!editingCell) return;
    const { rowKey, column } = editingCell;
    const row = dataRows.find((r) => r.__rowKey === rowKey);
    if (!row) {
      setEditingCell(null);
      setDataRows((prev) => prev.map((r) => (r.__editingCol ? { ...r, __editingCol: null } : r)));
      return;
    }

    const originalVal = row[column];
    const currentInputValue = (cellInputRef.current && cellInputRef.current.value !== undefined) ? cellInputRef.current.value : editingValue;
    const newVal = currentInputValue.trim() === '' ? 'NULL' : currentInputValue;
    const hasChanged = newVal !== originalVal;

    let nextCol = null;
    if (advanceNext || advancePrev) {
      const curColIdx = dataColumns.indexOf(column);
      const nextColIdx = advanceNext ? curColIdx + 1 : curColIdx - 1;
      if (nextColIdx >= 0 && nextColIdx < dataColumns.length) {
        nextCol = dataColumns[nextColIdx];
      }
    }

    setDataRows((prev) =>
      prev.map((r) => {
        if (r.__rowKey === rowKey) {
          return {
            ...r,
            [column]: newVal,
            __editingCol: nextCol,
          };
        }
        return r.__editingCol ? { ...r, __editingCol: null } : r;
      })
    );

    if (hasChanged || dirtyRows[rowKey]?.isNew) {
      const updatedModified = {
        ...(dirtyRows[rowKey]?.modified || {}),
        [column]: newVal,
      };

      if (autoSave && !dirtyRows[rowKey]?.isNew) {
        saveSingleRow(rowKey, { [column]: newVal }, row, false);
      } else {
        setDirtyRows((prev) => ({
          ...prev,
          [rowKey]: {
            original: prev[rowKey]?.original || { ...row },
            modified: updatedModified,
            isNew: !!row.__isNew,
          },
        }));
      }
    }

    if (nextCol) {
      const nextVal = row[nextCol];
      setEditingCell({ rowKey, column: nextCol });
      setEditingValue(nextVal === 'NULL' ? '' : nextVal);
    } else {
      setEditingCell(null);
    }
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setDataRows((prev) =>
      prev.map((r) => (r.__editingCol ? { ...r, __editingCol: null } : r))
    );
  };

  // --- RECORD FORM MODAL (IBExpert Record View) ---
  const openRecordEditor = (row, mode = 'edit') => {
    const targetRow = row || dataRows[selectedRowIndex];
    if (!targetRow && mode === 'edit') return;

    setRecordModalMode(mode);
    setRecordModalRowIndex(dataRows.findIndex((r) => r.__rowKey === targetRow?.__rowKey) || 0);

    const formData = {};
    const formNulls = {};

    dataColumns.forEach((c) => {
      if (mode === 'edit' && targetRow) {
        const val = targetRow[c];
        if (val === 'NULL' || val === null || val === undefined) {
          formData[c] = '';
          formNulls[c] = true;
        } else {
          formData[c] = val;
          formNulls[c] = false;
        }
      } else {
        const colMeta = (structure.colunas || []).find((m) => m.name === c);
        formData[c] = colMeta?.default_value || '';
        formNulls[c] = colMeta?.default_value ? false : colMeta?.nullable !== false;
      }
    });

    setRecordFormData(formData);
    setRecordFormNulls(formNulls);
    setRecordModalOpen(true);
  };

  const handleNavigateModalRow = (direction) => {
    let nextIdx = recordModalRowIndex;
    if (direction === 'first') nextIdx = 0;
    else if (direction === 'prev') nextIdx = Math.max(0, recordModalRowIndex - 1);
    else if (direction === 'next') nextIdx = Math.min(dataRows.length - 1, recordModalRowIndex + 1);
    else if (direction === 'last') nextIdx = dataRows.length - 1;

    if (nextIdx !== recordModalRowIndex && dataRows[nextIdx]) {
      setSelectedRowIndex(nextIdx);
      openRecordEditor(dataRows[nextIdx], 'edit');
    }
  };

  const handleSaveRecordModal = async () => {
    const isNew = recordModalMode === 'insert';
    const currentRow = isNew ? null : dataRows[recordModalRowIndex];
    const pkCols = getPkColumns();

    const keys = {};
    if (!isNew && currentRow) {
      pkCols.forEach((pk) => {
        keys[pk] = currentRow[pk];
      });
    }

    const valuesToSave = {};
    dataColumns.forEach((c) => {
      if (recordFormNulls[c]) {
        if (!isNew) valuesToSave[c] = null;
      } else {
        const val = recordFormData[c];
        if (val !== undefined && val !== '') {
          valuesToSave[c] = val;
        } else if (!isNew) {
          valuesToSave[c] = null;
        }
      }
    });

    setRecordSaving(true);
    try {
      await api.salvarLinha(
        activeDatabase.id,
        schemaName,
        tableName,
        isNew ? 'insert' : 'update',
        keys,
        valuesToSave
      );

      toast.current?.show({
        severity: 'success',
        summary: isNew ? 'Novo Registro Inserido' : 'Registro Atualizado',
        detail: `Operação concluída com sucesso no banco de dados.`,
        life: 3000,
      });

      setRecordModalOpen(false);
      loadData(page);
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Gravar',
        detail: e.message,
        life: 6000,
      });
    } finally {
      setRecordSaving(false);
    }
  };

  // --- DBNAVIGATOR ACTIONS ---
  const handleInsertRow = () => {
    openRecordEditor(null, 'insert');
  };

  const handleDeleteRow = () => {
    const currentRow = dataRows[selectedRowIndex];
    if (!currentRow) return;

    confirmDialog({
      message: `Tem certeza que deseja EXCLUIR o registro #${currentRow.__rowNum} da tabela ${tableName}?`,
      header: 'Confirmar Exclusão de Registro (DELETE)',
      icon: 'pi pi-exclamation-triangle text-red-500',
      acceptClassName: 'p-button-danger',
      acceptLabel: 'Excluir Definitivamente',
      rejectLabel: 'Cancelar',
      accept: async () => {
        const pkCols = getPkColumns();
        const keys = {};
        pkCols.forEach((pk) => {
          keys[pk] = currentRow[pk];
        });

        try {
          await api.removerLinha(activeDatabase.id, schemaName, tableName, keys);
          toast.current?.show({
            severity: 'success',
            summary: 'Exclusão',
            detail: `Registro #${currentRow.__rowNum} excluído com sucesso!`,
            life: 3000,
          });
          loadData(page);
        } catch (e) {
          toast.current?.show({
            severity: 'error',
            summary: 'Erro ao Excluir',
            detail: e.message,
            life: 5000,
          });
        }
      },
    });
  };

  // Manual Post (Batch)
  const handlePostChanges = async () => {
    await commitCellEdit();
    const dirtyKeys = Object.keys(dirtyRows);
    if (dirtyKeys.length === 0) {
      toast.current?.show({
        severity: 'info',
        summary: 'Gravar',
        detail: 'Nenhuma alteração pendente para gravar.',
        life: 2000,
      });
      return;
    }

    setSaving(true);
    let successCount = 0;
    const errors = [];
    const pkCols = getPkColumns();

    for (const key of dirtyKeys) {
      const { original, modified, isNew } = dirtyRows[key];
      const keys = {};
      pkCols.forEach((pk) => {
        keys[pk] = original[pk];
      });

      const valuesToSave = {};
      if (isNew) {
        const row = dataRows.find((r) => r.__rowKey === key);
        if (row) {
          dataColumns.forEach((c) => {
            const v = row[c];
            if (v !== 'NULL' && v !== undefined && v !== '') {
              valuesToSave[c] = v;
            }
          });
        }
      } else {
        Object.entries(modified).forEach(([c, val]) => {
          valuesToSave[c] = val === 'NULL' ? null : val;
        });
      }

      try {
        await api.salvarLinha(
          activeDatabase.id,
          schemaName,
          tableName,
          isNew ? 'insert' : 'update',
          keys,
          valuesToSave
        );
        successCount++;
      } catch (err) {
        errors.push(`Linha ${key}: ${err.message}`);
      }
    }

    setSaving(false);

    if (errors.length === 0) {
      toast.current?.show({
        severity: 'success',
        summary: 'Post Concluído (✓)',
        detail: `${successCount} registro(s) gravado(s) com sucesso no banco de dados!`,
        life: 3000,
      });
      setDirtyRows({});
      loadData(page);
    } else {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Gravar',
        detail: errors.join('; '),
        life: 6000,
      });
      loadData(page);
    }
  };

  const handleCancelChanges = () => {
    cancelCellEdit();
    setDataRows((prev) =>
      prev
        .filter((r) => !dirtyRows[r.__rowKey]?.isNew)
        .map((r) => {
          if (dirtyRows[r.__rowKey]) {
            return { ...dirtyRows[r.__rowKey].original };
          }
          return r;
        })
    );
    setDirtyRows({});
    toast.current?.show({
      severity: 'warn',
      summary: 'Alterações Canceladas (✗)',
      detail: 'Todas as modificações não gravadas foram descartadas.',
      life: 2500,
    });
  };

  // Keyboard Shortcuts (Ctrl+S, F2, Insert, Delete)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (subTab !== 3) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handlePostChanges();
      } else if (e.key === 'F2') {
        e.preventDefault();
        const r = dataRows[selectedRowIndex];
        if (r && dataColumns.length > 0) {
          startCellEdit(r, dataColumns[0]);
        }
      } else if (e.key === 'Insert' && !editingCell && !recordModalOpen) {
        e.preventDefault();
        handleInsertRow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [subTab, editingCell, dirtyRows, dataRows, selectedRowIndex, recordModalOpen]);

  // Context Menu Items
  const contextMenuItems = useMemo(() => [
    {
      label: 'Editar Célula Inline (F2)',
      icon: 'pi pi-pencil text-yellow-400',
      command: () => {
        if (contextRow && contextCol) {
          startCellEdit(contextRow, contextCol);
        } else if (contextRow && dataColumns.length > 0) {
          startCellEdit(contextRow, dataColumns[0]);
        }
      },
    },
    {
      label: 'Editar Registro no Formulário...',
      icon: 'pi pi-window-maximize text-blue-400 font-bold',
      command: () => {
        if (contextRow) openRecordEditor(contextRow, 'edit');
      },
    },
    {
      label: 'Novo Registro (Insert)...',
      icon: 'pi pi-plus text-green-400',
      command: () => handleInsertRow(),
    },
    {
      label: 'Excluir Registro (Delete)',
      icon: 'pi pi-trash text-red-400',
      command: () => handleDeleteRow(),
    },
    { separator: true },
    {
      label: 'Definir Célula como NULL',
      icon: 'pi pi-ban text-gray-400',
      command: () => {
        if (contextRow && contextCol) {
          const rowKey = contextRow.__rowKey;
          setDataRows((prev) =>
            prev.map((r) => (r.__rowKey === rowKey ? { ...r, [contextCol]: 'NULL' } : r))
          );
          if (autoSave) {
            saveSingleRow(rowKey, { [contextCol]: 'NULL' }, contextRow, false);
          } else {
            setDirtyRows((prev) => ({
              ...prev,
              [rowKey]: {
                original: prev[rowKey]?.original || { ...contextRow },
                modified: { ...(prev[rowKey]?.modified || {}), [contextCol]: 'NULL' },
                isNew: false,
              },
            }));
          }
        }
      },
    },
    {
      label: 'Copiar Conteúdo da Célula',
      icon: 'pi pi-clone text-teal-400',
      command: () => {
        if (contextRow && contextCol) {
          navigator.clipboard.writeText(contextRow[contextCol] || '');
          toast.current?.show({ severity: 'info', summary: 'Copiado', detail: 'Valor copiado', life: 1500 });
        }
      },
    },
    {
      label: 'Copiar Linha como SQL INSERT',
      icon: 'pi pi-copy text-indigo-400',
      command: () => {
        if (!contextRow) return;
        const cols = dataColumns.map((c) => `"${c}"`).join(', ');
        const vals = dataColumns
          .map((c) => (contextRow[c] === 'NULL' ? 'NULL' : `'${String(contextRow[c]).replace(/'/g, "''")}'`))
          .join(', ');
        const sql = `INSERT INTO "${schemaName}"."${tableName}" (${cols}) VALUES (${vals});`;
        navigator.clipboard.writeText(sql);
        toast.current?.show({ severity: 'info', summary: 'Copiado', detail: 'SQL INSERT copiado para área de transferência', life: 2500 });
      },
    },
    { separator: true },
    {
      label: 'Atualizar Dados (F5)',
      icon: 'pi pi-refresh text-blue-300',
      command: () => loadData(page),
    },
  ], [contextRow, contextCol, dataColumns, autoSave, schemaName, tableName, page, loadData, toast]);

  const hasDirty = Object.keys(dirtyRows).length > 0;

  return (
    <div className="ib-table-viewer">
      <ContextMenu model={contextMenuItems} ref={cm} />
      <ConfirmDialog />

      {/* RECORD FORM EDITOR MODAL (IBExpert Model) */}
      <Dialog
        header={
          <div className="flex align-items-center justify-content-between w-full pr-4">
            <div className="flex align-items-center gap-2">
              <i className="pi pi-file-edit text-blue-400 text-lg" />
              <span className="font-bold font-mono">
                {recordModalMode === 'insert' ? 'Inserir Novo Registro' : `Editar Registro #${(dataRows[recordModalRowIndex]?.__rowNum) || ''}`}
              </span>
              <span className="text-muted text-xs font-mono ml-2">
                ({schemaName}.{tableName})
              </span>
            </div>

            {recordModalMode === 'edit' && (
              <div className="flex align-items-center gap-1">
                <Button
                  icon="pi pi-angle-double-left"
                  size="small"
                  text
                  disabled={recordModalRowIndex <= 0}
                  onClick={() => handleNavigateModalRow('first')}
                  title="Primeiro Registro"
                />
                <Button
                  icon="pi pi-angle-left"
                  size="small"
                  text
                  disabled={recordModalRowIndex <= 0}
                  onClick={() => handleNavigateModalRow('prev')}
                  title="Registro Anterior"
                />
                <span className="text-xs font-mono px-2 text-gray-300">
                  {recordModalRowIndex + 1} / {dataRows.length}
                </span>
                <Button
                  icon="pi pi-angle-right"
                  size="small"
                  text
                  disabled={recordModalRowIndex >= dataRows.length - 1}
                  onClick={() => handleNavigateModalRow('next')}
                  title="Próximo Registro"
                />
                <Button
                  icon="pi pi-angle-double-right"
                  size="small"
                  text
                  disabled={recordModalRowIndex >= dataRows.length - 1}
                  onClick={() => handleNavigateModalRow('last')}
                  title="Último Registro"
                />
              </div>
            )}
          </div>
        }
        visible={recordModalOpen}
        style={{ width: '850px', maxWidth: '95vw' }}
        onHide={() => setRecordModalOpen(false)}
        footer={
          <div className="flex justify-content-between align-items-center w-full">
            <span className="text-xs text-muted font-mono">
              Pressione <kbd className="px-1 bg-darker border-round">Tab</kbd> para navegar entre campos
            </span>
            <div className="flex gap-2">
              <Button
                label="Cancelar (Esc)"
                icon="pi pi-times"
                className="p-button-secondary p-button-sm"
                onClick={() => setRecordModalOpen(false)}
              />
              <Button
                label={recordModalMode === 'insert' ? 'Inserir no Banco (F9)' : 'Gravar Alterações (F9)'}
                icon="pi pi-check"
                className="p-button-success p-button-sm font-bold"
                loading={recordSaving}
                onClick={handleSaveRecordModal}
              />
            </div>
          </div>
        }
      >
        <div className="p-fluid grid pt-2" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {dataColumns.map((colName) => {
            const colMeta = (structure.colunas || []).find((c) => c.name === colName);
            const isPk = colMeta?.is_primary_key;
            const dataType = colMeta?.data_type || 'varchar';
            const isNullable = colMeta?.nullable !== false;
            const isNull = recordFormNulls[colName] || false;
            const currentVal = recordFormData[colName] ?? '';

            const isLongText = dataType === 'text' || dataType.includes('json');

            return (
              <div key={colName} className={isLongText ? 'col-12 mb-2' : 'col-6 mb-2'}>
                <div className="flex justify-content-between align-items-center mb-1">
                  <label className="font-bold text-xs font-mono flex align-items-center gap-1">
                    {isPk && <i className="pi pi-key text-yellow-400" title="Chave Primária" />}
                    <span>{colName}</span>
                    <span className="text-muted font-normal text-xs">({dataType})</span>
                  </label>
                  {isNullable && (
                    <Button
                      label={isNull ? 'NULL (Ativo)' : 'Marcar NULL'}
                      size="small"
                      text
                      className={`py-0 px-1 text-xs ${isNull ? 'p-button-warning font-bold' : 'p-button-secondary text-muted'}`}
                      onClick={() => {
                        setRecordFormNulls((prev) => ({ ...prev, [colName]: !prev[colName] }));
                        if (!isNull) {
                          setRecordFormData((prev) => ({ ...prev, [colName]: '' }));
                        }
                      }}
                    />
                  )}
                </div>

                {isNull ? (
                  <div className="p-inputtext p-inputtext-sm font-mono text-muted italic bg-darker border-dashed border-secondary">
                    &lt;NULL&gt;
                  </div>
                ) : isLongText ? (
                  <InputTextarea
                    value={currentVal}
                    onChange={(e) => setRecordFormData((prev) => ({ ...prev, [colName]: e.target.value }))}
                    rows={3}
                    autoResize
                    className="p-inputtext-sm font-mono w-full"
                    placeholder={`Valor de ${colName}...`}
                  />
                ) : dataType === 'bool' || dataType === 'boolean' ? (
                  <Dropdown
                    value={currentVal === 'true' || currentVal === true ? 'true' : currentVal === 'false' || currentVal === false ? 'false' : ''}
                    options={[
                      { label: 'TRUE', value: 'true' },
                      { label: 'FALSE', value: 'false' },
                    ]}
                    onChange={(e) => setRecordFormData((prev) => ({ ...prev, [colName]: e.value }))}
                    className="p-inputtext-sm font-mono"
                    placeholder="Selecione..."
                  />
                ) : (
                  <InputText
                    value={currentVal}
                    onChange={(e) => setRecordFormData((prev) => ({ ...prev, [colName]: e.target.value }))}
                    className="p-inputtext-sm font-mono w-full"
                    placeholder={`Valor de ${colName}...`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Dialog>

      {/* Header with Table Name & Info */}
      <div className="table-viewer-header flex justify-content-between align-items-center">
        <div className="flex align-items-center gap-2">
          <i className="pi pi-table text-blue-400 text-lg" />
          <span className="font-bold text-lg font-mono">
            {schemaName}.{tableName}
          </span>
          <span className="text-muted text-xs font-mono ml-2">
            ({structure.colunas?.length || 0} fields · {structure.indices?.length || 0} indices)
          </span>
        </div>

        {hasDirty && !autoSave && (
          <div className="flex align-items-center gap-2 px-3 py-1 bg-yellow-900 border-round text-yellow-200 text-xs font-bold font-mono">
            <i className="pi pi-pencil" />
            <span>{Object.keys(dirtyRows).length} registro(s) modificado(s) pendente(s)</span>
            <Button
              icon="pi pi-check"
              label="Gravar Agora (Post)"
              size="small"
              severity="success"
              className="ml-2 py-0 px-2 text-xs"
              onClick={handlePostChanges}
              loading={saving}
            />
          </div>
        )}
      </div>

      <TabView activeIndex={subTab} onTabChange={(e) => setSubTab(e.index)} className="ib-table-tabs">
        {/* SubTab 1: Fields / Columns */}
        <TabPanel header={`Fields (${structure.colunas.length})`} leftIcon="pi pi-list">
          <DataTable
            value={structure.colunas}
            size="small"
            scrollable
            scrollHeight="calc(100vh - 260px)"
            className="ib-data-table font-mono"
            stripedRows
          >
            <Column field="position" header="#" style={{ width: '50px' }} />
            <Column field="name" header="Field Name" sortable style={{ fontWeight: 'bold' }} />
            <Column field="data_type" header="Data Type / Domain" sortable />
            <Column
              field="nullable"
              header="Nullable"
              body={(r) => (r.nullable ? 'YES' : <span className="text-red-400 font-bold">NO</span>)}
            />
            <Column field="default_value" header="Default Expression" body={(r) => r.default_value || 'None'} />
            <Column
              field="is_primary_key"
              header="PK"
              body={(r) => (r.is_primary_key ? <i className="pi pi-key text-yellow-400 font-bold" /> : '')}
              style={{ width: '60px', textAlign: 'center' }}
            />
          </DataTable>
        </TabPanel>

        {/* SubTab 2: Constraints */}
        <TabPanel header={`Constraints (${structure.restricoes.length})`} leftIcon="pi pi-shield">
          <DataTable
            value={structure.restricoes}
            size="small"
            scrollable
            scrollHeight="calc(100vh - 260px)"
            className="ib-data-table font-mono"
            emptyMessage="Nenhuma constraint encontrada."
          >
            <Column field="name" header="Constraint Name" sortable />
            <Column field="constraint_type" header="Type" sortable />
            <Column field="columns" header="Columns" body={(r) => (r.columns || []).join(', ')} />
          </DataTable>
        </TabPanel>

        {/* SubTab 3: Indices */}
        <TabPanel header={`Indices (${structure.indices.length})`} leftIcon="pi pi-bolt">
          <DataTable
            value={structure.indices}
            size="small"
            scrollable
            scrollHeight="calc(100vh - 260px)"
            className="ib-data-table font-mono"
            emptyMessage="Nenhum índice encontrado."
          >
            <Column field="name" header="Index Name" sortable />
            <Column field="is_unique" header="Unique" body={(r) => (r.is_unique ? 'UNIQUE' : 'INDEX')} />
            <Column field="is_primary" header="Primary Key" body={(r) => (r.is_primary ? 'PRIMARY' : 'SECONDARY')} />
          </DataTable>
        </TabPanel>

        {/* SubTab 4: Live Data Grid with In-Place Cell Editing, DBNavigator & Form Editor */}
        <TabPanel header={`Data (${totalRows})`} leftIcon="pi pi-database">
          {/* Classic Delphi / InterBase / IBExpert DBNavigator Bar */}
          <div className="ib-dbnavigator-bar flex flex-wrap justify-content-between align-items-center mb-2 p-2 bg-darker border-1 border-secondary border-round">
            {/* VCR Record Navigation Buttons */}
            <div className="flex align-items-center gap-1">
              <Button
                icon="pi pi-angle-double-left"
                className="p-button-sm p-button-secondary p-button-outlined"
                tooltip="Primeiro Registro (|<)"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0 || selectedRowIndex === 0}
                onClick={() => setSelectedRowIndex(0)}
              />
              <Button
                icon="pi pi-angle-left"
                className="p-button-sm p-button-secondary p-button-outlined"
                tooltip="Registro Anterior (<)"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0 || selectedRowIndex <= 0}
                onClick={() => setSelectedRowIndex((prev) => Math.max(0, prev - 1))}
              />
              <Button
                icon="pi pi-angle-right"
                className="p-button-sm p-button-secondary p-button-outlined"
                tooltip="Próximo Registro (>)"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0 || selectedRowIndex >= dataRows.length - 1}
                onClick={() => setSelectedRowIndex((prev) => Math.min(dataRows.length - 1, prev + 1))}
              />
              <Button
                icon="pi pi-angle-double-right"
                className="p-button-sm p-button-secondary p-button-outlined"
                tooltip="Último Registro (>|)"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0 || selectedRowIndex === dataRows.length - 1}
                onClick={() => setSelectedRowIndex(dataRows.length - 1)}
              />

              <div className="border-left-1 border-secondary mx-2" style={{ height: '24px' }} />

              {/* CRUD & Record View Controls */}
              <Button
                icon="pi pi-plus"
                label="Inserir (+)"
                className="p-button-sm p-button-success p-button-outlined font-bold"
                tooltip="Inserir Novo Registro no Banco"
                tooltipOptions={{ position: 'bottom' }}
                onClick={handleInsertRow}
              />
              <Button
                icon="pi pi-window-maximize"
                label="Formulário (✎)"
                className="p-button-sm p-button-info p-button-outlined font-bold"
                tooltip="Abrir Editor de Formulário do Registro (Estilo IBExpert)"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0}
                onClick={() => openRecordEditor(dataRows[selectedRowIndex], 'edit')}
              />
              <Button
                icon="pi pi-trash"
                className="p-button-sm p-button-danger p-button-outlined"
                tooltip="Excluir Registro (- / Delete)"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0}
                onClick={handleDeleteRow}
              />

              <div className="border-left-1 border-secondary mx-2" style={{ height: '24px' }} />

              {/* AutoSave Toggle & Batch Actions */}
              <Button
                icon={autoSave ? 'pi pi-bolt' : 'pi pi-save'}
                label={autoSave ? 'Auto-Commit: ON' : 'Auto-Commit: OFF'}
                className={`p-button-sm ${autoSave ? 'p-button-warning font-bold' : 'p-button-secondary'}`}
                tooltip={autoSave ? 'Auto-Commit ATIVO: Grava automaticamente no banco ao sair da célula ou pressionar Enter.' : 'Auto-Commit DESATIVADO: Modificações requerem clicar em Post (✓).'}
                tooltipOptions={{ position: 'bottom' }}
                onClick={() => {
                  setAutoSave((prev) => !prev);
                  toast.current?.show({
                    severity: 'info',
                    summary: 'Modo de Gravação',
                    detail: !autoSave ? 'Auto-Commit ATIVADO.' : 'Auto-Commit DESATIVADO (Modo em Lote).',
                    life: 2000,
                  });
                }}
              />

              {!autoSave && (
                <>
                  <Button
                    icon="pi pi-check"
                    label="Post"
                    className="p-button-sm p-button-success font-bold"
                    tooltip="Gravar Alterações em Lote (Ctrl+S)"
                    tooltipOptions={{ position: 'bottom' }}
                    disabled={!hasDirty}
                    loading={saving}
                    onClick={handlePostChanges}
                  />
                  <Button
                    icon="pi pi-times"
                    label="Cancel"
                    className="p-button-sm p-button-secondary"
                    tooltip="Desfazer Alterações Pendentes (Esc)"
                    tooltipOptions={{ position: 'bottom' }}
                    disabled={!hasDirty}
                    onClick={handleCancelChanges}
                  />
                </>
              )}

              <Button
                icon="pi pi-refresh"
                className="p-button-sm p-button-secondary p-button-text"
                tooltip="Atualizar Tabela (F5 / Refresh)"
                tooltipOptions={{ position: 'bottom' }}
                onClick={() => loadData(page)}
              />
            </div>

            {/* Quick Filter & Pagination */}
            <div className="flex align-items-center gap-2">
              <span className="p-input-icon-left">
                <i className="pi pi-filter text-xs" />
                <InputText
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadData(1)}
                  placeholder="Filtro rápido..."
                  className="p-inputtext-sm font-mono"
                  style={{ width: '150px' }}
                />
              </span>
              <Button icon="pi pi-search" size="small" text onClick={() => loadData(1)} />

              <div className="flex gap-1 align-items-center ml-2">
                <Button
                  icon="pi pi-chevron-left"
                  size="small"
                  text
                  disabled={page <= 1}
                  onClick={() => loadData(page - 1)}
                />
                <span className="text-xs font-mono text-muted">
                  Pág. {page} / {Math.ceil(totalRows / 50) || 1}
                </span>
                <Button
                  icon="pi pi-chevron-right"
                  size="small"
                  text
                  disabled={page * 50 >= totalRows}
                  onClick={() => loadData(page + 1)}
                />
              </div>
            </div>
          </div>

          {/* Interactive Live Editable Data Table */}
          <div className="ib-grid-container" style={{ position: 'relative' }}>
            <DataTable
              value={dataRows}
              dataKey="__rowKey"
              size="small"
              scrollable
              scrollHeight="calc(100vh - 310px)"
              loading={loadingData}
              className="ib-data-table font-mono ib-editable-grid"
              stripedRows
              rowHover
              rowClassName={(data) => {
                const idx = dataRows.findIndex((r) => r.__rowKey === data.__rowKey);
                return idx === selectedRowIndex ? 'p-highlight' : '';
              }}
              onContextMenu={(e) => {
                setContextRow(e.data);
                cm.current?.show(e.originalEvent);
              }}
            >
              {/* Record Selector Column (IBExpert Style) */}
              <Column
                field="__rowNum"
                header="#"
                style={{ width: '65px', textAlign: 'center', userSelect: 'none' }}
                body={(r, { rowIndex }) => {
                  const isSelected = rowIndex === selectedRowIndex;
                  const isSavingThis = savingCellKey === r.__rowKey;
                  const isDirty = dirtyRows[r.__rowKey]?.modified && Object.keys(dirtyRows[r.__rowKey].modified).length > 0;

                  let icon = null;
                  if (isSavingThis) {
                    icon = <i className="pi pi-spin pi-spinner text-yellow-400 font-bold mr-1" />;
                  } else if (isDirty) {
                    icon = <i className="pi pi-pencil text-yellow-400 font-bold mr-1" title="Registro Modificado (pendente de Post)" />;
                  } else if (isSelected) {
                    icon = <span className="text-blue-400 font-bold mr-1">►</span>;
                  }

                  return (
                    <div
                      className="flex align-items-center justify-content-center cursor-pointer"
                      title="Clique duplo para abrir no Formulário"
                      onClick={() => setSelectedRowIndex(rowIndex)}
                      onDoubleClick={() => openRecordEditor(r, 'edit')}
                    >
                      {icon}
                      <span className="text-muted text-xs">{r.__rowNum}</span>
                    </div>
                  );
                }}
              />

              {/* Dynamic Columns with In-Place Cell Editing */}
              {dataColumns.map((colName) => {
                const colMeta = (structure.colunas || []).find((c) => c.name === colName);
                const colType = colMeta?.data_type ? `(${colMeta.data_type})` : '';

                return (
                  <Column
                    key={colName}
                    field={colName}
                    header={
                      <div>
                        <div className="font-bold">{colName}</div>
                        {colType && <div className="text-muted text-xs font-normal">{colType}</div>}
                      </div>
                    }
                    sortable
                    body={(row, { rowIndex }) => {
                      const isEditing = row.__editingCol === colName;
                      const isCellDirty = dirtyRows[row.__rowKey]?.modified?.[colName] !== undefined;
                      const cellVal = row[colName];

                      if (isEditing) {
                        return (
                          <div
                            className="ib-cell-editor-wrapper"
                            style={{ margin: '-4px -6px' }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <InputText
                              ref={cellInputRef}
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitCellEdit(false, false);
                                } else if (e.key === 'Tab') {
                                  e.preventDefault();
                                  commitCellEdit(!e.shiftKey, e.shiftKey);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelCellEdit();
                                }
                              }}
                              className="p-inputtext-sm font-mono w-full ib-cell-active-input"
                              style={{
                                background: '#0d131f',
                                color: '#ffffff',
                                border: '2px solid #00aaff',
                                padding: '3px 6px',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                            />
                          </div>
                        );
                      }

                      const isNull = cellVal === 'NULL';
                      const cellClass = isCellDirty
                        ? 'ib-cell-dirty'
                        : isNull
                        ? 'text-gray-500 italic'
                        : '';

                      return (
                        <div
                          className={`ib-cell-view cursor-pointer py-1 px-1 border-round ${cellClass}`}
                          title="Clique para editar | Botão direito para opções"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRowIndex(rowIndex);
                            startCellEdit(row, colName);
                          }}
                          onContextMenu={() => {
                            setSelectedRowIndex(rowIndex);
                            setContextRow(row);
                            setContextCol(colName);
                          }}
                          style={{
                            minHeight: '22px',
                            background: isCellDirty ? 'rgba(234, 179, 8, 0.15)' : 'transparent',
                            border: isCellDirty ? '1px dashed #eab308' : '1px solid transparent',
                          }}
                        >
                          {cellVal}
                        </div>
                      );
                    }}
                  />
                );
              })}
            </DataTable>
          </div>

          {/* Grid Footer / Status Bar */}
          <div className="flex justify-content-between align-items-center mt-2 px-2 py-1 text-xs font-mono text-muted border-top-1 border-secondary">
            <div className="flex gap-3">
              <span>Linha selecionada: {dataRows.length > 0 ? selectedRowIndex + 1 : 0} de {dataRows.length}</span>
              <span>Total no banco: {totalRows}</span>
              <span>Modo: {autoSave ? 'Auto-Commit Ativo' : 'Gravação Manual'}</span>
            </div>
            <div className="flex gap-2">
              <span>Clique em qualquer célula para editar inline</span>
              <span>·</span>
              <span>Duplo clique no # para abrir Formulário</span>
            </div>
          </div>
        </TabPanel>

        {/* SubTab 5: DDL Script */}
        <TabPanel header="DDL" leftIcon="pi pi-code">
          <div className="p-2">
            <pre className="ib-ddl-output font-mono p-3 bg-darker border-1 border-secondary border-round overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              {ddlText}
            </pre>
          </div>
        </TabPanel>
      </TabView>
    </div>
  );
}
