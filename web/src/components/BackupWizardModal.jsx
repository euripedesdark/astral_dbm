import React, { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Checkbox } from 'primereact/checkbox';
import { ProgressBar } from 'primereact/progressbar';

export default function BackupWizardModal({ visible, onHide, activeDatabase, toast }) {
  const [step, setStep] = useState(3); // matching Screenshot B (step 3: Backup Options)
  const [backupType, setBackupType] = useState('full');
  const [ignoreChecksums, setIgnoreChecksums] = useState(false);
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [backupFile, setBackupFile] = useState(
    activeDatabase ? `/var/backups/astral/${activeDatabase.database}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.gbk` : '/var/backups/astral/backup.gbk'
  );
  const [inProgress, setInProgress] = useState(false);
  const [progressVal, setProgressVal] = useState(0);

  const stepsList = [
    { num: 1, label: 'Welcome' },
    { num: 2, label: 'Select Database' },
    { num: 3, label: 'Backup Options' },
    { num: 4, label: 'Summary' },
    { num: 5, label: 'Progress' },
  ];

  const handleNext = () => {
    if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      setStep(5);
      setInProgress(true);
      let p = 0;
      const interval = setInterval(() => {
        p += 25;
        setProgressVal(p);
        if (p >= 100) {
          clearInterval(interval);
          setInProgress(false);
          toast.current?.show({
            severity: 'success',
            summary: 'Backup Concluído',
            detail: `Arquivo gerado com sucesso: ${backupFile}`,
            life: 5000,
          });
        }
      }, 500);
    } else if (step < 5) {
      setStep((s) => s + 1);
    } else {
      onHide();
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((s) => s - 1);
    }
  };

  return (
    <Dialog
      header="Database Backup Wizard"
      visible={visible}
      style={{ width: '42rem' }}
      onHide={onHide}
      className="ib-wizard-modal"
    >
      <div className="ib-wizard-container">
        {/* Left Stepper Sidebar */}
        <div className="ib-wizard-sidebar">
          {stepsList.map((st) => (
            <div
              key={st.num}
              className={`ib-wizard-step ${step === st.num ? 'active' : ''} ${step > st.num ? 'completed' : ''}`}
            >
              <div className="step-bullet">{st.num}</div>
              <div className="step-name">{st.label}</div>
            </div>
          ))}
        </div>

        {/* Right Content Area */}
        <div className="ib-wizard-content">
          {step === 1 && (
            <div className="step-pane">
              <h3>Bem-vindo ao Assistente de Backup InterBase</h3>
              <p>Este assistente guiará você na criação de uma cópia de segurança confiável da sua base de dados.</p>
            </div>
          )}

          {step === 2 && (
            <div className="step-pane">
              <h3>Selecionar Banco de Dados</h3>
              <label>Banco Alvo:</label>
              <InputText value={activeDatabase?.nome || 'Nenhum banco selecionado'} disabled className="w-full" />
            </div>
          )}

          {step === 3 && (
            <div className="step-pane">
              <div className="ib-field mb-3">
                <label>Backup Type (Full/Incremental)</label>
                <Dropdown
                  value={backupType}
                  options={[
                    { label: 'Full Database Backup (Completo)', value: 'full' },
                    { label: 'Incremental Backup (Diferencial)', value: 'incremental' },
                  ]}
                  onChange={(e) => setBackupType(e.value)}
                  className="w-full"
                />
              </div>

              <div className="ib-field-check mb-2">
                <Checkbox inputId="chk" checked={ignoreChecksums} onChange={(e) => setIgnoreChecksums(e.checked)} />
                <label htmlFor="chk" className="ml-2">Ignore Checksums (Recuperação de falhas)</label>
              </div>

              <div className="ib-field-check mb-3">
                <Checkbox inputId="meta" checked={metadataOnly} onChange={(e) => setMetadataOnly(e.checked)} />
                <label htmlFor="meta" className="ml-2">Metadata Only (Apenas DDL e Estruturas)</label>
              </div>

              <div className="ib-field">
                <label>Backup file (.gbk / .fbk):</label>
                <InputText
                  value={backupFile}
                  onChange={(e) => setBackupFile(e.target.value)}
                  className="w-full font-mono text-sm"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="step-pane">
              <h3>Resumo do Backup</h3>
              <ul className="text-sm">
                <li><strong>Banco:</strong> {activeDatabase?.database}</li>
                <li><strong>Tipo:</strong> {backupType === 'full' ? 'Full Backup' : 'Incremental'}</li>
                <li><strong>Arquivo:</strong> {backupFile}</li>
                <li><strong>Somente Metadados:</strong> {metadataOnly ? 'Sim' : 'Não'}</li>
              </ul>
            </div>
          )}

          {step === 5 && (
            <div className="step-pane">
              <h3>Executando Backup InterBase...</h3>
              <ProgressBar value={progressVal} style={{ height: '1.2rem', marginTop: '1rem' }} />
              <div className="mt-2 text-xs text-muted">
                {inProgress ? 'Extraindo páginas de dados e gerando snapshot GBK...' : 'Backup concluído com sucesso!'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ib-dialog-footer">
        <Button label="Back" text onClick={handleBack} disabled={step === 1 || inProgress} />
        <Button
          label={step === 4 ? 'Iniciar Backup' : step === 5 ? 'Concluir' : 'Next >'}
          icon={step === 4 ? 'pi pi-play' : undefined}
          onClick={handleNext}
          disabled={inProgress}
        />
      </div>
    </Dialog>
  );
}
