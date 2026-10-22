use crate::domain::isql::{IsqlRequest, IsqlResult};
use crate::engine::postgres::PostgresEngine;
use crate::error::{DbmError, Result};
use crate::service::session_manager::SessionManager;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct IsqlService {
    session_manager: Arc<SessionManager>,
}

impl IsqlService {
    pub fn new(session_manager: Arc<SessionManager>) -> Self {
        Self { session_manager }
    }

    pub async fn execute(&self, connection_id: Uuid, req: IsqlRequest) -> Result<IsqlResult> {
        let config = self.session_manager.get_config(connection_id).await?;
        let is_write = !req.sql.trim().to_uppercase().starts_with("SELECT")
            && !req.sql.trim().to_uppercase().starts_with("SHOW")
            && !req.sql.trim().to_uppercase().starts_with("EXPLAIN");

        if config.readonly && is_write {
            return Err(DbmError::Validation(
                "Conexão configurada em modo SOMENTE-LEITURA. Operações DDL e DML de escrita estão bloqueadas."
                    .to_string(),
            ));
        }

        let client = self.session_manager.get_client(connection_id).await?;
        PostgresEngine::execute_query(&client, &req.sql, req.explain_plan).await
    }

    pub async fn commit(&self, connection_id: Uuid) -> Result<IsqlResult> {
        let client = self.session_manager.get_client(connection_id).await?;
        PostgresEngine::execute_query(&client, "COMMIT;", false).await
    }

    pub async fn rollback(&self, connection_id: Uuid) -> Result<IsqlResult> {
        let client = self.session_manager.get_client(connection_id).await?;
        PostgresEngine::execute_query(&client, "ROLLBACK;", false).await
    }
}
