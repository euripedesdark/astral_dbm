import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TabView, TabPanel } from 'primereact/tabview';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { ContextMenu } from 'primereact/contextmenu';
import api from '../api.js';

// Helper: detect type characteristics from metadata
function getColTypeInfo(colMeta) {
  const dt = (colMeta?.data_type || colMeta?.udt_name || '').toLowerCase();
  const isNumeric = [
    'int8', 'int4', 'int2', 'numeric', 'float8', 'float4',
    'decimal', 'integer', 'bigint', 'smallint', 'double precision',
    'real', 'serial', 'bigserial', 'money', 'oid'
  ].some((t) => dt.includes(t));
  const isBool = dt === 'bool' || dt === 'boolean';
  const isDate = ['date', 'timestamp', 'timestamptz', 'time'].some((t) => dt.includes(t));
  const isJson = dt === 'json' || dt === 'jsonb';
  const isLongText = dt === 'text' || isJson || dt.includes('varchar(max)');
  return { dataType: dt || 'varchar', isNumeric, isBool, isDate, isJson, isLongText };
}

// Helper: cell renderer that preserves data types
function formatCell(val, colMeta) {
  if (val === null || val === undefined || val === 'NULL') {
    return <span className="ib-null-badge">&lt;NULL&gt;</span>;
  }
  const { isNumeric, isBool, isDate, isJson } = getColTypeInfo(colMeta);

  if (isBool || typeof val === 'boolean') {
    const isTrue = val === true || String(val).toLowerCase() === 'true';
    return (
      <span className={`ib-bool-badge ${isTrue ? 'ib-bool-true' : 'ib-bool-false'}`}>
        {isTrue ? 'TRUE' : 'FALSE'}
      </span>
    );
  }

  if (isNumeric || (typeof val === 'number' && !isNaN(val))) {
    const formatted = typeof val === 'number' ? val.toLocaleString('pt-BR') : String(val);
    return <span className="ib-numeric-cell font-mono">{formatted}</span>;
  }

  if (isDate) {
    return (
      <span className="ib-date-cell font-mono">
        <i className="pi pi-calendar text-xs mr-1 text-gray-400" />
        {String(val)}
      </span>
    );
  }

  if (isJson || typeof val === 'object') {
    return (
      <span className="ib-json-cell font-mono">
        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
      </span>
    );
  }

  return <span className="ib-text-cell">{String(val)}</span>;
}

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

  // Settings — Auto-Save ativo por padrão
  const [autoSave, setAutoSave] = useState(true);

  // Selection & In-Place Editing State
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [editingCell, setEditingCell] = useState(null); // { rowKey, column }
  const [editingValue, setEditingValue] = useState('');
  const [dirtyRows, setDirtyRows] = useState({});
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

  // Dedicated Delete Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState(null);
  const [deletingRow, setDeletingRow] = useState(false);

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

  // Always fetch full structure if indices/constraints or columns are incomplete
  useEffect(() => {
    if (!activeDatabase || !tableName) return;
    const needsFetch =
      !table?.columns ||
      table.columns.length === 0 ||
      !structure.indices ||
      structure.indices.length === 0;

    if (needsFetch) {
      api
        .estrutura(activeDatabase.id, schemaName, tableName)
        .then((res) => {
          if (res) {
            setStructure({
              colunas: res.colunas || table?.columns || [],
              restricoes: res.restricoes || table?.constraints || [],
              indices: res.indices || table?.indices || [],
            });
          }
        })
        .catch(() => {});
    } else {
      setStructure({
        colunas: table.columns || [],
        restricoes: table.constraints || [],
        indices: table.indices || [],
      });
    }
  }, [table, activeDatabase, schemaName, tableName]);

  // Fetch Live Table Data
  const loadData = useCallback(
    async (p = 1) => {
      if (!activeDatabase || !tableName) return;
      setLoadingData(true);
      try {
        const res = await api.dados(activeDatabase.id, schemaName, tableName, p, 50, search);
        const cols = res.columns || [];
        setDataColumns(cols);

        const mapped = (res.rows || []).map((r, i) => {
          const item = {
            __rowNum: (p - 1) * 50 + i + 1,
            __rowKey: `row_${(p - 1) * 50 + i + 1}`,
            __editingCol: null,
          };
          cols.forEach((c, idx) => {
            const rawVal = Array.isArray(r) ? r[idx] : r && r[c] !== undefined ? r[c] : r?.[idx];
            item[c] = rawVal === undefined ? null : rawVal;
          });
          return item;
        });

        setDataRows(mapped);
        setTotalRows(res.total_rows || 0);
        setPage(p);
        setDirtyRows({});
        setEditingCell(null);
        setSelectedRowIndex((prev) => (prev < mapped.length ? prev : 0));
      } catch (e) {
        toast.current?.show({ severity: 'error', summary: 'Dados', detail: e.message, life: 5000 });
      } finally {
        setLoadingData(false);
      }
    },
    [activeDatabase, tableName, schemaName, search, toast]
  );

  // Fetch DDL
  const loadDdl = useCallback(async () => {
    if (!activeDatabase || !tableName) return;
    try {
      const res = await api.ddl(activeDatabase.id, schemaName, tableName, 'tabela', tableName);
      setDdlText(res.ddl || '');
    } catch (e) {
      setDdlText(`-- Erro ao carregar DDL: ${e.message}`);
    }
  }, [activeDatabase, schemaName, tableName]);

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

  // Robust Primary Key Columns resolver
  const getPkColumns = useCallback(() => {
    // 1. Explicit primary key flag from columns
    const pks = (structure.colunas || [])
      .filter((c) => c.is_primary_key)
      .map((c) => c.name);
    if (pks.length > 0) return pks;

    // 2. Column named id
    if (dataColumns.includes('id')) return ['id'];

    // 3. Primary or unique indices
    const pIdx = (structure.indices || []).find((idx) => idx.is_primary && idx.columns?.length > 0);
    if (pIdx) return pIdx.columns;
    const uIdx = (structure.indices || []).find((idx) => idx.is_unique && idx.columns?.length > 0);
    if (uIdx) return uIdx.columns;

    // 4. Common identifier patterns
    for (const c of ['uuid', 'codigo', 'cd', 'chave', 'pk']) {
      if (dataColumns.includes(c)) return [c];
    }

    // 5. Fallback: first column if present
    return dataColumns.length > 0 ? [dataColumns[0]] : [];
  }, [structure.colunas, structure.indices, dataColumns]);

  // Helper: find column metadata
  const findColMeta = useCallback(
    (colName) => {
      return (structure.colunas || []).find(
        (c) => c.name?.toLowerCase() === colName?.toLowerCase()
      );
    },
    [structure.colunas]
  );

  // --- SAVE ROW DIRECTLY ---
  const saveSingleRow = async (rowKey, modifiedFields, originalRow, isNew = false) => {
    if (!activeDatabase || !tableName) return false;
    const pkCols = getPkColumns();
    if (!isNew && pkCols.length === 0) {
      toast.current?.show({
        severity: 'error',
        summary: 'Edição indisponível',
        detail: 'Tabela sem chave primária identificada.',
        life: 5000,
      });
      return false;
    }

    const keys = {};
    if (!isNew && originalRow) {
      pkCols.forEach((pk) => {
        const v = originalRow[pk];
        keys[pk] = v === 'NULL' || v === undefined ? null : v;
      });
    }

    const valuesToSave = {};
    Object.entries(modifiedFields).forEach(([col, val]) => {
      const colMeta = findColMeta(col);
      const { isNumeric, isBool } = getColTypeInfo(colMeta);
      if (val === 'NULL' || val === undefined || val === '') {
        valuesToSave[col] = colMeta?.nullable !== false ? null : '';
      } else if (isNumeric) {
        const n = Number(val);
        valuesToSave[col] = isNaN(n) ? val : n;
      } else if (isBool) {
        valuesToSave[col] = val === true || String(val).toLowerCase() === 'true';
      } else {
        valuesToSave[col] = val;
      }
    });

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
                  updated[k] = v;
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
        detail: 'Registro gravado com sucesso no banco.',
        life: 2000,
      });
      return true;
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Salvar',
        detail: e.message || 'Erro de execução SQL no banco de dados',
        life: 8000,
      });
      return false;
    } finally {
      setSavingCellKey(null);
    }
  };

  // --- IN-LINE CELL EDITING ---
  const startCellEdit = (row, column) => {
    if (!row) return;
    const pkCols = getPkColumns();
    if (pkCols.includes(column)) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Chave primária protegida',
        detail: 'A chave primária não deve ser alterada diretamente na grade.',
        life: 3000,
      });
      return;
    }
    const rowKey = row.__rowKey;
    const currentVal =
      dirtyRows[rowKey]?.modified?.[column] !== undefined
        ? dirtyRows[rowKey].modified[column]
        : row[column];

    setEditingCell({ rowKey, column });
    setEditingValue(currentVal === null || currentVal === undefined || currentVal === 'NULL' ? '' : String(currentVal));

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

    const colMeta = findColMeta(column);
    const { isNumeric, isBool } = getColTypeInfo(colMeta);
    const originalVal = row[column];
    const currentInputValue =
      cellInputRef.current && cellInputRef.current.value !== undefined
        ? cellInputRef.current.value
        : editingValue;

    let newVal = null;
    if (currentInputValue.trim() === '') {
      newVal = colMeta?.nullable !== false ? null : '';
    } else if (isNumeric) {
      const n = Number(currentInputValue);
      newVal = isNaN(n) ? currentInputValue : n;
    } else if (isBool) {
      newVal = currentInputValue.toLowerCase() === 'true';
    } else {
      newVal = currentInputValue;
    }

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
      setEditingValue(nextVal === null || nextVal === undefined ? '' : String(nextVal));
    } else {
      setEditingCell(null);
    }
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setDataRows((prev) => prev.map((r) => (r.__editingCol ? { ...r, __editingCol: null } : r)));
  };

  // --- RECORD FORM MODAL (IBExpert Record View) ---
  const openRecordEditor = (row, mode = 'edit') => {
    const targetRow = row || dataRows[selectedRowIndex] || (dataRows.length > 0 ? dataRows[0] : null);
    if (!targetRow && mode === 'edit') return;

    setRecordModalMode(mode);
    const rowIdx = targetRow ? dataRows.findIndex((r) => r.__rowKey === targetRow.__rowKey) : 0;
    setRecordModalRowIndex(rowIdx >= 0 ? rowIdx : 0);

    const formData = {};
    const formNulls = {};

    const cols = dataColumns.length > 0 ? dataColumns : (structure.colunas || []).map((c) => c.name);

    cols.forEach((c) => {
      if (mode === 'edit' && targetRow) {
        const val = targetRow[c];
        const isValNull = val === null || val === undefined || val === 'NULL';
        formData[c] = isValNull ? '' : val;
        formNulls[c] = isValNull;
      } else {
        const colMeta = findColMeta(c);
        const defVal = colMeta?.default_value;
        const isFunc = defVal && /^(nextval|gen_random_uuid|now|current_timestamp|clock_timestamp|uuid_generate)/i.test(defVal);
        if (defVal && !isFunc) {
          formData[c] = defVal.replace(/^'|'::.*$/g, '');
          formNulls[c] = false;
        } else {
          formData[c] = '';
          formNulls[c] = false; // Always editable by default!
        }
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
        const v = currentRow[pk];
        keys[pk] = v === 'NULL' || v === undefined ? null : v;
      });
    }

    const valuesToSave = {};
    const cols = dataColumns.length > 0 ? dataColumns : (structure.colunas || []).map((c) => c.name);

    cols.forEach((c) => {
      const colMeta = findColMeta(c);
      const { isNumeric, isBool } = getColTypeInfo(colMeta);
      const isPk = !!colMeta?.is_primary_key || (pkCols.length === 1 && pkCols[0] === c);
      const isNullMarked = !!recordFormNulls[c];
      const val = recordFormData[c];

      if (isNew) {
        // Insert Mode
        if (isNullMarked) {
          if (colMeta?.nullable !== false) {
            valuesToSave[c] = null;
          }
        } else if (val !== undefined && val !== null && val !== '') {
          if (isNumeric) {
            const num = Number(val);
            valuesToSave[c] = isNaN(num) ? val : num;
          } else if (isBool) {
            valuesToSave[c] = val === true || String(val).toLowerCase() === 'true';
          } else {
            valuesToSave[c] = val;
          }
        }
        // Empties on insert are omitted to allow DB defaults
      } else {
        // Update Mode
        if (isPk) {
          // Do not update PK column in SET clause
          return;
        }
        if (isNullMarked) {
          valuesToSave[c] = null;
        } else if (val === undefined || val === null || val === '') {
          valuesToSave[c] = colMeta?.nullable !== false ? null : '';
        } else if (isNumeric) {
          const num = Number(val);
          valuesToSave[c] = isNaN(num) ? val : num;
        } else if (isBool) {
          valuesToSave[c] = val === true || String(val).toLowerCase() === 'true';
        } else {
          valuesToSave[c] = val;
        }
      }
    });

    if (Object.keys(valuesToSave).length === 0 && !isNew) {
      toast.current?.show({
        severity: 'info',
        summary: 'Gravação',
        detail: 'Nenhum campo modificado para atualizar.',
        life: 2500,
      });
      setRecordModalOpen(false);
      return;
    }

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
        detail: isNew ? 'Registro gravado com sucesso!' : 'Alterações salvas no banco.',
        life: 3000,
      });

      setRecordModalOpen(false);
      await loadData(page);
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Gravar',
        detail: e.message || 'Erro de execução SQL no banco de dados',
        life: 8000,
      });
    } finally {
      setRecordSaving(false);
    }
  };

  // --- CRUD ACTIONS ---
  const handleInsertRow = () => {
    openRecordEditor(null, 'insert');
  };

  const handleDeleteRow = () => {
    const currentRow = dataRows[selectedRowIndex];
    if (!currentRow) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Exclusão',
        detail: 'Selecione uma linha na tabela para excluir.',
        life: 3000,
      });
      return;
    }
    setRowToDelete(currentRow);
    setDeleteModalOpen(true);
  };

  const executeDeleteRow = async () => {
    if (!rowToDelete || !activeDatabase || !tableName) return;
    const pkCols = getPkColumns();
    const keys = {};
    pkCols.forEach((pk) => {
      keys[pk] = rowToDelete[pk];
    });

    setDeletingRow(true);
    try {
      await api.removerLinha(activeDatabase.id, schemaName, tableName, keys);
      toast.current?.show({
        severity: 'success',
        summary: 'Exclusão Concluída',
        detail: `Registro #${rowToDelete.__rowNum} removido com sucesso.`,
        life: 3000,
      });
      setDeleteModalOpen(false);
      setRowToDelete(null);
      await loadData(page);
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Excluir',
        detail: e.message || 'Falha ao excluir registro.',
        life: 8000,
      });
    } finally {
      setDeletingRow(false);
    }
  };

  // Manual Post (Batch)
  const handlePostChanges = async () => {
    if (editingCell) {
      await commitCellEdit();
    }
    const pkCols = getPkColumns();
    if (pkCols.length === 0) {
      toast.current?.show({
        severity: 'error',
        summary: 'Edição indisponível',
        detail: 'Não foi identificada chave primária segura.',
        life: 5000,
      });
      return;
    }
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
            if (v !== 'NULL' && v !== undefined && v !== null && v !== '') {
              valuesToSave[c] = v;
            }
          });
        }
      } else {
        Object.entries(modified).forEach(([c, val]) => {
          valuesToSave[c] = val === 'NULL' || val === undefined || val === '' ? null : val;
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
        summary: 'Post Concluído',
        detail: `${successCount} registro(s) gravado(s) com sucesso.`,
        life: 3000,
      });
      setDirtyRows({});
      await loadData(page);
    } else {
      toast.current?.show({
        severity: 'error',
        summary: 'Erros na Gravação',
        detail: errors.join('\n'),
        life: 8000,
      });
    }
  };

  const handleCancelChanges = () => {
    cancelCellEdit();
    setDataRows((prev) =>
      prev
        .filter((r) => !r.__isNew)
        .map((r) => {
          const rowKey = r.__rowKey;
          if (dirtyRows[rowKey]) {
            return { ...r, ...dirtyRows[rowKey].original, __editingCol: null };
          }
          return { ...r, __editingCol: null };
        })
    );
    setDirtyRows({});
    toast.current?.show({
      severity: 'info',
      summary: 'Cancelado',
      detail: 'Alterações pendentes foram descartadas.',
      life: 2000,
    });
  };

  // Context Menu Actions
  const contextMenuItems = useMemo(
    () => [
      {
        label: 'Editar Registro no Formulário',
        icon: 'pi pi-window-maximize text-blue-400',
        command: () => contextRow && openRecordEditor(contextRow, 'edit'),
      },
      {
        label: 'Novo Registro...',
        icon: 'pi pi-plus text-green-400',
        command: () => openRecordEditor(null, 'insert'),
      },
      {
        label: 'Excluir Linha Selecionada',
        icon: 'pi pi-trash text-red-400',
        command: () => {
          if (contextRow) {
            setRowToDelete(contextRow);
            setDeleteModalOpen(true);
          }
        },
      },
      { separator: true },
      {
        label: 'Definir Célula como NULL',
        icon: 'pi pi-ban text-gray-400',
        command: () => {
          if (contextRow && contextCol) {
            const rowKey = contextRow.__rowKey;
            setDataRows((prev) =>
              prev.map((r) => (r.__rowKey === rowKey ? { ...r, [contextCol]: null } : r))
            );
            if (autoSave) {
              saveSingleRow(rowKey, { [contextCol]: null }, contextRow, false);
            } else {
              setDirtyRows((prev) => ({
                ...prev,
                [rowKey]: {
                  original: prev[rowKey]?.original || { ...contextRow },
                  modified: { ...(prev[rowKey]?.modified || {}), [contextCol]: null },
                  isNew: false,
                },
              }));
            }
          }
        },
      },
      {
        label: 'Copiar Valor da Célula',
        icon: 'pi pi-copy text-primary',
        command: () => {
          if (contextRow && contextCol) {
            const v = contextRow[contextCol];
            navigator.clipboard?.writeText(String(v ?? ''));
            toast.current?.show({
              severity: 'info',
              summary: 'Copiado',
              detail: `Valor "${v}" copiado para área de transferência.`,
              life: 1500,
            });
          }
        },
      },
      {
        label: 'Copiar Linha como INSERT SQL',
        icon: 'pi pi-code text-teal-400',
        command: () => {
          if (!contextRow) return;
          const cols = dataColumns.map((c) => `"${c}"`).join(', ');
          const vals = dataColumns
            .map((c) => {
              const val = contextRow[c];
              if (val === null || val === undefined || val === 'NULL') return 'NULL';
              if (typeof val === 'number') return val;
              if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
              return `'${String(val).replace(/'/g, "''")}'`;
            })
            .join(', ');
          const sql = `INSERT INTO "${schemaName}"."${tableName}" (${cols}) VALUES (${vals});`;
          navigator.clipboard?.writeText(sql);
          toast.current?.show({
            severity: 'info',
            summary: 'Copiado',
            detail: 'SQL INSERT copiado para área de transferência',
            life: 2500,
          });
        },
      },
      { separator: true },
      {
        label: 'Atualizar Dados (F5)',
        icon: 'pi pi-refresh text-blue-300',
        command: () => loadData(page),
      },
    ],
    [contextRow, contextCol, dataColumns, autoSave, schemaName, tableName, page, loadData, toast]
  );

  const hasDirty = Object.keys(dirtyRows).length > 0;
  const targetRowForHeader = dataRows[recordModalRowIndex];
  const pkCols = getPkColumns();
  const pkVal = pkCols.length > 0 && targetRowForHeader ? targetRowForHeader[pkCols[0]] : null;
  const pkLabel = pkVal !== null && pkVal !== undefined && pkVal !== 'NULL' ? ` [${pkCols[0]}: ${pkVal}]` : '';
  const currentRecordNum = targetRowForHeader?.__rowNum || (recordModalRowIndex >= 0 ? recordModalRowIndex + 1 : 1);

  const modalFormTitle =
    recordModalMode === 'insert'
      ? `Inserir Novo Registro — ${tableName || 'Tabela'}`
      : `Editar Registro #${currentRecordNum}${pkLabel}`;

  const colsToRenderInForm = dataColumns.length > 0 ? dataColumns : (structure.colunas || []).map((c) => c.name);

  return (
    <div className="ib-table-viewer">
      <ContextMenu model={contextMenuItems} ref={cm} />

      {/* RECORD FORM EDITOR MODAL (IBExpert Style) */}
      <Dialog
        header={
          <div className="flex align-items-center justify-content-between w-full pr-4">
            <span className="font-bold flex align-items-center gap-2">
              <i className="pi pi-file-edit text-primary" />
              <span>{modalFormTitle}</span>
            </span>
            {recordModalMode === 'edit' && dataRows.length > 1 && (
              <div className="flex gap-1">
                <Button
                  icon="pi pi-angle-double-left"
                  size="small"
                  text
                  disabled={recordModalRowIndex <= 0}
                  onClick={() => handleNavigateModalRow('first')}
                  tooltip="Primeiro Registro"
                />
                <Button
                  icon="pi pi-angle-left"
                  size="small"
                  text
                  disabled={recordModalRowIndex <= 0}
                  onClick={() => handleNavigateModalRow('prev')}
                  tooltip="Registro Anterior"
                />
                <span className="px-2 font-mono text-xs text-muted flex align-items-center">
                  {recordModalRowIndex + 1} de {dataRows.length}
                </span>
                <Button
                  icon="pi pi-angle-right"
                  size="small"
                  text
                  disabled={recordModalRowIndex >= dataRows.length - 1}
                  onClick={() => handleNavigateModalRow('next')}
                  tooltip="Próximo Registro"
                />
                <Button
                  icon="pi pi-angle-double-right"
                  size="small"
                  text
                  disabled={recordModalRowIndex >= dataRows.length - 1}
                  onClick={() => handleNavigateModalRow('last')}
                  tooltip="Último Registro"
                />
              </div>
            )}
          </div>
        }
        visible={recordModalOpen}
        style={{ width: '850px', maxWidth: '95vw' }}
        modal
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
          {colsToRenderInForm.map((colName) => {
            const colMeta = findColMeta(colName);
            const { dataType, isNumeric, isBool, isLongText } = getColTypeInfo(colMeta);
            const isPk = !!colMeta?.is_primary_key || (pkCols.length === 1 && pkCols[0] === colName);
            const isNullable = colMeta?.nullable !== false;
            const isNull = recordFormNulls[colName] || false;
            const currentVal = recordFormData[colName];

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
                      label={isNull ? 'NULL (Ativo)' : 'Definir NULL'}
                      size="small"
                      text
                      className={`py-0 px-1 text-xs ${
                        isNull ? 'p-button-warning font-bold' : 'p-button-secondary text-muted'
                      }`}
                      onClick={() => {
                        const nextNull = !isNull;
                        setRecordFormNulls((prev) => ({ ...prev, [colName]: nextNull }));
                        if (nextNull) {
                          setRecordFormData((prev) => ({ ...prev, [colName]: '' }));
                        }
                      }}
                    />
                  )}
                </div>

                {isBool ? (
                  <Dropdown
                    value={
                      isNull
                        ? null
                        : currentVal === true || String(currentVal).toLowerCase() === 'true'
                        ? 'true'
                        : currentVal === false || String(currentVal).toLowerCase() === 'false'
                        ? 'false'
                        : null
                    }
                    options={[
                      ...(isNullable ? [{ label: '<NULL / Vazio>', value: null }] : []),
                      { label: 'TRUE', value: 'true' },
                      { label: 'FALSE', value: 'false' },
                    ]}
                    onChange={(e) => {
                      if (e.value === null) {
                        setRecordFormNulls((prev) => ({ ...prev, [colName]: true }));
                        setRecordFormData((prev) => ({ ...prev, [colName]: '' }));
                      } else {
                        setRecordFormNulls((prev) => ({ ...prev, [colName]: false }));
                        setRecordFormData((prev) => ({ ...prev, [colName]: e.value === 'true' }));
                      }
                    }}
                    className="p-inputtext-sm font-mono"
                    placeholder={isNull ? '<NULL>' : 'Selecione...'}
                  />
                ) : isNumeric ? (
                  <InputNumber
                    value={
                      isNull || currentVal === '' || currentVal === null || currentVal === undefined
                        ? null
                        : Number(currentVal)
                    }
                    onValueChange={(e) => {
                      setRecordFormNulls((prev) => ({ ...prev, [colName]: false }));
                      setRecordFormData((prev) => ({ ...prev, [colName]: e.value !== null && e.value !== undefined ? e.value : '' }));
                    }}
                    className="p-inputtext-sm font-mono w-full"
                    placeholder={isNull ? '<NULL>' : isPk && recordModalMode === 'insert' ? '(Automático no Banco)' : '0'}
                  />
                ) : isLongText ? (
                  <InputTextarea
                    value={isNull ? '' : (currentVal ?? '')}
                    onChange={(e) => {
                      setRecordFormNulls((prev) => ({ ...prev, [colName]: false }));
                      setRecordFormData((prev) => ({ ...prev, [colName]: e.target.value }));
                    }}
                    rows={3}
                    autoResize
                    className="p-inputtext-sm font-mono w-full"
                    placeholder={isNull ? '<NULL>' : `Valor de ${colName}...`}
                  />
                ) : (
                  <InputText
                    value={isNull ? '' : (currentVal ?? '')}
                    onChange={(e) => {
                      setRecordFormNulls((prev) => ({ ...prev, [colName]: false }));
                      setRecordFormData((prev) => ({ ...prev, [colName]: e.target.value }));
                    }}
                    className="p-inputtext-sm font-mono w-full"
                    placeholder={isNull ? '<NULL>' : isPk && recordModalMode === 'insert' ? '(Automático no Banco)' : `Valor de ${colName}...`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Dialog>

      {/* DEDICATED DELETE CONFIRMATION MODAL */}
      <Dialog
        header={<span><i className="pi pi-exclamation-triangle text-red-500 mr-2" />Confirmar Exclusão de Registro (DELETE)</span>}
        visible={deleteModalOpen}
        style={{ width: '480px' }}
        modal
        onHide={() => !deletingRow && setDeleteModalOpen(false)}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              label="Cancelar"
              icon="pi pi-times"
              className="p-button-secondary p-button-sm"
              disabled={deletingRow}
              onClick={() => setDeleteModalOpen(false)}
            />
            <Button
              label="Excluir Definitivamente"
              icon="pi pi-trash"
              className="p-button-danger p-button-sm font-bold"
              loading={deletingRow}
              onClick={executeDeleteRow}
            />
          </div>
        }
      >
        <div className="pt-2">
          <p className="m-0 text-sm">
            Tem certeza que deseja apagar o registro <strong>#{rowToDelete?.__rowNum}</strong> da tabela <strong>{tableName}</strong>?
          </p>
          {rowToDelete && (
            <div className="mt-3 p-2 bg-darker border-1 border-secondary border-round font-mono text-xs">
              {getPkColumns().map((pk) => (
                <div key={pk} className="py-1">
                  <strong>{pk}:</strong> <span className="text-yellow-300">{String(rowToDelete[pk])}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-red-400 mt-3 mb-0">
            <i className="pi pi-info-circle mr-1" />
            Esta operação executará um comando DELETE definitivo no banco de dados.
          </p>
        </div>
      </Dialog>

      {/* Header with Table Name & Info */}
      <div className="table-viewer-header flex justify-content-between align-items-center">
        <div className="flex align-items-center gap-2">
          <i className="pi pi-table text-blue-400 text-lg" />
          <span className="font-bold text-lg font-mono">
            {schemaName || 'public'}.{tableName || 'Tabela'}
          </span>
          <span className="text-xs text-muted font-mono">({totalRows} registros no total)</span>
        </div>
        {hasDirty && (
          <div className="flex align-items-center">
            <span className="text-xs text-yellow-400 font-bold mr-2">
              <i className="pi pi-exclamation-circle mr-1" />
              {Object.keys(dirtyRows).length} registro(s) pendente(s) de gravação
            </span>
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

        {/* SubTab 4: Data Grid (Live Interactive Editing) */}
        <TabPanel header={`Data (${totalRows})`} leftIcon="pi pi-table">
          <div className="ib-grid-toolbar flex justify-content-between align-items-center mb-2 px-1">
            <div className="flex align-items-center gap-1">
              {/* Pagination Controls */}
              <Button
                icon="pi pi-angle-double-left"
                className="p-button-sm p-button-secondary p-button-text"
                tooltip="Primeira Página"
                tooltipOptions={{ position: 'bottom' }}
                disabled={page <= 1}
                onClick={() => loadData(1)}
              />
              <Button
                icon="pi pi-angle-left"
                className="p-button-sm p-button-secondary p-button-text"
                tooltip="Página Anterior"
                tooltipOptions={{ position: 'bottom' }}
                disabled={page <= 1}
                onClick={() => loadData(page - 1)}
              />
              <Button
                icon="pi pi-angle-right"
                className="p-button-sm p-button-secondary p-button-text"
                tooltip="Próxima Página"
                tooltipOptions={{ position: 'bottom' }}
                disabled={page * 50 >= totalRows}
                onClick={() => loadData(page + 1)}
              />
              <Button
                icon="pi pi-angle-double-right"
                className="p-button-sm p-button-secondary p-button-text"
                tooltip="Última Página"
                tooltipOptions={{ position: 'bottom' }}
                disabled={page * 50 >= totalRows}
                onClick={() => loadData(Math.ceil(totalRows / 50))}
              />

              <div className="border-left-1 border-secondary mx-2" style={{ height: '24px' }} />

              {/* CRUD Controls */}
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
                label="Editar no Formulário"
                className="p-button-sm p-button-info p-button-outlined font-bold"
                tooltip="Abrir formulário de registro"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0}
                onClick={() => openRecordEditor(dataRows[selectedRowIndex], 'edit')}
              />
              <Button
                icon="pi pi-pencil"
                label="Editar Célula (F2)"
                className="p-button-sm p-button-warning p-button-outlined"
                tooltip="Editar diretamente na grade"
                tooltipOptions={{ position: 'bottom' }}
                disabled={dataRows.length === 0}
                onClick={() => {
                  const col = dataColumns.find((name) => !getPkColumns().includes(name));
                  if (col) startCellEdit(dataRows[selectedRowIndex], col);
                }}
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
                tooltip={
                  autoSave
                    ? 'Auto-Commit ATIVO: Grava automaticamente no banco ao sair da célula ou pressionar Enter.'
                    : 'Auto-Commit DESATIVADO: Modificações requerem clicar em Post (✓).'
                }
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

              <div className="flex align-items-center gap-1 ml-2">
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
              selectionMode="single"
              selection={dataRows[selectedRowIndex] || null}
              onSelectionChange={(e) => {
                if (e.value) {
                  const idx = dataRows.findIndex((r) => r.__rowKey === e.value.__rowKey);
                  if (idx >= 0) setSelectedRowIndex(idx);
                }
              }}
              onRowClick={(e) => {
                const idx = dataRows.findIndex((r) => r.__rowKey === e.data?.__rowKey);
                if (idx >= 0) setSelectedRowIndex(idx);
              }}
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
                  const isDirty =
                    dirtyRows[r.__rowKey]?.modified &&
                    Object.keys(dirtyRows[r.__rowKey].modified).length > 0;

                  let icon = null;
                  if (isSavingThis) {
                    icon = <i className="pi pi-spin pi-spinner text-yellow-400 font-bold mr-1" />;
                  } else if (isDirty) {
                    icon = (
                      <i
                        className="pi pi-pencil text-yellow-400 font-bold mr-1"
                        title="Registro Modificado (pendente de Post)"
                      />
                    );
                  } else if (isSelected) {
                    icon = <span className="text-blue-400 font-bold mr-1">►</span>;
                  }

                  return (
                    <div
                      className="flex align-items-center justify-content-center cursor-pointer"
                      title="Clique para selecionar; duplo clique para abrir formulário de edição"
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
                const colMeta = findColMeta(colName);
                const { isNumeric } = getColTypeInfo(colMeta);
                const colType = colMeta?.data_type;

                return (
                  <Column
                    key={colName}
                    field={colName}
                    header={
                      <div style={{ textAlign: isNumeric ? 'right' : 'left' }}>
                        <div className="font-bold">{colName}</div>
                        {colType && <div className="text-muted text-xs font-normal">{colType}</div>}
                      </div>
                    }
                    style={{ textAlign: isNumeric ? 'right' : 'left' }}
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
                            <input
                              type={isNumeric ? 'number' : 'text'}
                              ref={cellInputRef}
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => commitCellEdit()}
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
                                textAlign: isNumeric ? 'right' : 'left',
                                outline: 'none',
                              }}
                            />
                          </div>
                        );
                      }

                      const isNull = cellVal === null || cellVal === undefined || cellVal === 'NULL';
                      const cellClass = isCellDirty
                        ? 'ib-cell-dirty'
                        : isNull
                        ? 'text-gray-500 italic'
                        : '';

                      return (
                        <div
                          className={`ib-cell-view cursor-pointer py-1 px-1 border-round ${cellClass}`}
                          title="Clique para editar · Duplo clique para formulário · Enter confirma"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRowIndex(rowIndex);
                            startCellEdit(row, colName);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setSelectedRowIndex(rowIndex);
                            openRecordEditor(row, 'edit');
                          }}
                          onContextMenu={() => {
                            setSelectedRowIndex(rowIndex);
                            setContextRow(row);
                            setContextCol(colName);
                          }}
                          style={{
                            minHeight: '22px',
                            textAlign: isNumeric ? 'right' : 'left',
                            background: isCellDirty ? 'rgba(234, 179, 8, 0.15)' : 'transparent',
                            border: isCellDirty ? '1px dashed #eab308' : '1px solid transparent',
                          }}
                        >
                          {formatCell(cellVal, colMeta)}
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
              <span>
                Linha selecionada: {dataRows.length > 0 ? selectedRowIndex + 1 : 0} de {dataRows.length}
              </span>
              <span>Total no banco: {totalRows}</span>
              <span>Modo: {autoSave ? 'Auto-Commit Ativo' : 'Gravação Manual'}</span>
            </div>
            <div className="flex gap-2">
              <span>Clique na célula para edição inline · Duplo clique abre formulário</span>
              <span>·</span>
              <span>Enter conclui · Post grava no banco</span>
            </div>
          </div>
        </TabPanel>

        {/* SubTab 5: DDL Script */}
        <TabPanel header="DDL" leftIcon="pi pi-code">
          <div className="p-2">
            <pre
              className="ib-ddl-output font-mono p-3 bg-darker border-1 border-secondary border-round overflow-auto"
              style={{ maxHeight: 'calc(100vh - 280px)' }}
            >
              {ddlText}
            </pre>
          </div>
        </TabPanel>
      </TabView>
    </div>
  );
}
