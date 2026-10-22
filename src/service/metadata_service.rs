use crate::domain::isql::{TableBrowseRequest, TableBrowseResult, TableDdlResult};
use crate::domain::metadata::IbDatabaseCatalog;
use crate::engine::postgres::PostgresEngine;
use crate::error::Result;
use crate::service::session_manager::SessionManager;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct MetadataService {
    session_manager: Arc<SessionManager>,
}

impl MetadataService {
    pub fn new(session_manager: Arc<SessionManager>) -> Self {
        Self { session_manager }
    }

    pub async fn get_catalog(&self, connection_id: Uuid) -> Result<IbDatabaseCatalog> {
        let client = self.session_manager.get_client(connection_id).await?;
        let config = self.session_manager.get_config(connection_id).await?;
        PostgresEngine::introspect_catalog(&client, &config).await
    }

    pub async fn browse_table(
        &self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
        req: TableBrowseRequest,
    ) -> Result<TableBrowseResult> {
        let client = self.session_manager.get_client(connection_id).await?;
        PostgresEngine::browse_table(
            &client,
            schema,
            table,
            req.page,
            req.page_size,
            req.search.as_deref(),
        )
        .await
    }

    pub async fn generate_ddl(
        &self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<TableDdlResult> {
        let client = self.session_manager.get_client(connection_id).await?;
        PostgresEngine::generate_ddl(&client, schema, table).await
    }
}
