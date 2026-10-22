use crate::domain::connection::{ConnectionConfig, ConnectionStatus};
use crate::engine::postgres::PostgresEngine;
use crate::error::{DbmError, Result};
use crate::storage::registry::ConnectionRegistry;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_postgres::Client;
use uuid::Uuid;

#[allow(dead_code)]
pub struct ActiveSession {
    pub connection_id: Uuid,
    pub config: ConnectionConfig,
    pub client: Arc<Client>,
    pub connected_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub server_version: String,
}

#[derive(Clone)]
pub struct SessionManager {
    registry: Arc<ConnectionRegistry>,
    sessions: Arc<RwLock<HashMap<Uuid, ActiveSession>>>,
}

impl SessionManager {
    pub fn new(registry: Arc<ConnectionRegistry>) -> Self {
        Self {
            registry,
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn connect(&self, id: Uuid) -> Result<ConnectionStatus> {
        let config = self
            .registry
            .get(id)
            .await
            .ok_or_else(|| DbmError::NotFound(format!("Conexão {} não cadastrada", id)))?;

        // Se já conectado, retorna status ativo
        {
            let lock = self.sessions.read().await;
            if let Some(session) = lock.get(&id) {
                return Ok(ConnectionStatus::from_parts(
                    &session.config,
                    true,
                    Some(session.server_version.clone()),
                    Some(session.connected_at),
                ));
            }
        }

        // Conecta dinamicamente sob demanda
        let (client, connection) = PostgresEngine::connect_raw(&config).await?;

        tokio::spawn(async move {
            if let Err(e) = connection.await {
                tracing::debug!("Conexão Postgres {} finalizada: {}", id, e);
            }
        });

        let ver_row = client
            .query_one("SELECT version()", &[])
            .await
            .map_err(|e| DbmError::Connection(format!("Falha ao obter versão na conexão: {}", e)))?;
        let server_version: String = ver_row.get(0);

        let now = Utc::now();
        let session = ActiveSession {
            connection_id: id,
            config: config.clone(),
            client: Arc::new(client),
            connected_at: now,
            last_active: now,
            server_version: server_version.clone(),
        };

        {
            let mut lock = self.sessions.write().await;
            lock.insert(id, session);
        }

        tracing::info!(
            "Conexão sob demanda estabelecida: {} ({}:{})",
            config.name,
            config.host,
            config.database
        );

        Ok(ConnectionStatus::from_parts(
            &config,
            true,
            Some(server_version),
            Some(now),
        ))
    }

    pub async fn disconnect(&self, id: Uuid) -> Result<()> {
        let mut lock = self.sessions.write().await;
        if let Some(sess) = lock.remove(&id) {
            tracing::info!("Desconectando sob demanda: {} ({})", sess.config.name, id);
        }
        Ok(())
    }

    pub async fn get_client(&self, id: Uuid) -> Result<Arc<Client>> {
        {
            let mut lock = self.sessions.write().await;
            if let Some(sess) = lock.get_mut(&id) {
                sess.last_active = Utc::now();
                return Ok(sess.client.clone());
            }
        }

        // Estabelece conexão sob demanda no momento do primeiro acesso
        self.connect(id).await?;

        let lock = self.sessions.read().await;
        lock.get(&id)
            .map(|s| s.client.clone())
            .ok_or_else(|| DbmError::Disconnected("Falha ao recuperar sessão sob demanda".to_string()))
    }

    pub async fn get_config(&self, id: Uuid) -> Result<ConnectionConfig> {
        self.registry
            .get(id)
            .await
            .ok_or_else(|| DbmError::NotFound(format!("Conexão {} não encontrada", id)))
    }

    pub async fn list_statuses(&self) -> Vec<ConnectionStatus> {
        let configs = self.registry.list().await;
        let sessions = self.sessions.read().await;

        configs
            .into_iter()
            .map(|cfg| {
                let id = cfg.id;
                if let Some(sess) = sessions.get(&id) {
                    ConnectionStatus::from_parts(
                        &cfg,
                        true,
                        Some(sess.server_version.clone()),
                        Some(sess.connected_at),
                    )
                } else {
                    ConnectionStatus::from_parts(&cfg, false, None, None)
                }
            })
            .collect()
    }
}
