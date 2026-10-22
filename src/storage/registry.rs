use crate::domain::connection::ConnectionConfig;
use crate::error::{DbmError, Result};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Clone)]
pub struct ConnectionRegistry {
    file_path: PathBuf,
    cache: Arc<RwLock<Vec<ConnectionConfig>>>,
}

impl ConnectionRegistry {
    pub async fn load_or_init(preferred_dir: &Path) -> Result<Self> {
        let file_path = preferred_dir.join("connections.json");

        if let Some(parent) = file_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }

        let mut configs = Vec::new();
        if file_path.exists() {
            match fs::read_to_string(&file_path).await {
                Ok(content) => {
                    if let Ok(parsed) = serde_json::from_str::<Vec<ConnectionConfig>>(&content) {
                        configs = parsed;
                    }
                }
                Err(e) => {
                    tracing::warn!("Não foi possível ler {}: {}", file_path.display(), e);
                }
            }
        }

        Ok(Self {
            file_path,
            cache: Arc::new(RwLock::new(configs)),
        })
    }

    pub async fn list(&self) -> Vec<ConnectionConfig> {
        let lock = self.cache.read().await;
        lock.clone()
    }

    pub async fn get(&self, id: Uuid) -> Option<ConnectionConfig> {
        let lock = self.cache.read().await;
        lock.iter().find(|c| c.id == id).cloned()
    }

    pub async fn add(&self, config: ConnectionConfig) -> Result<()> {
        let mut lock = self.cache.write().await;
        lock.retain(|c| c.id != config.id);
        lock.push(config);
        self.save_locked(&lock).await
    }

    pub async fn update(&self, config: ConnectionConfig) -> Result<()> {
        let mut lock = self.cache.write().await;
        if let Some(pos) = lock.iter().position(|c| c.id == config.id) {
            lock[pos] = config;
            self.save_locked(&lock).await
        } else {
            Err(DbmError::NotFound(format!("Conexão {} não encontrada", config.id)))
        }
    }

    pub async fn remove(&self, id: Uuid) -> Result<()> {
        let mut lock = self.cache.write().await;
        let prev_len = lock.len();
        lock.retain(|c| c.id != id);
        if lock.len() < prev_len {
            self.save_locked(&lock).await
        } else {
            Err(DbmError::NotFound(format!("Conexão {} não encontrada", id)))
        }
    }

    async fn save_locked(&self, configs: &[ConnectionConfig]) -> Result<()> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| DbmError::Io(format!("Falha ao criar diretório: {}", e)))?;
        }

        let json = serde_json::to_string_pretty(configs)
            .map_err(|e| DbmError::Internal(format!("Falha ao serializar conexões: {}", e)))?;

        fs::write(&self.file_path, json)
            .await
            .map_err(|e| DbmError::Io(format!("Falha ao salvar conexões: {}", e)))?;

        Ok(())
    }
}
