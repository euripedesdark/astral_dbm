use crate::service::isql_service::IsqlService;
use crate::service::metadata_service::MetadataService;
use crate::service::session_manager::SessionManager;
use crate::storage::registry::ConnectionRegistry;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<ConnectionRegistry>,
    pub session_manager: Arc<SessionManager>,
    pub metadata_service: Arc<MetadataService>,
    pub isql_service: Arc<IsqlService>,
}

impl AppState {
    pub fn new(registry: Arc<ConnectionRegistry>) -> Self {
        let session_manager = Arc::new(SessionManager::new(registry.clone()));
        let metadata_service = Arc::new(MetadataService::new(session_manager.clone()));
        let isql_service = Arc::new(IsqlService::new(session_manager.clone()));

        Self {
            registry,
            session_manager,
            metadata_service,
            isql_service,
        }
    }
}
