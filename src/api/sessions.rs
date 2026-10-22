use crate::api::ApiResponse;
use crate::error::Result;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

pub async fn connect_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<crate::domain::connection::ConnectionStatus>>> {
    let status = state.session_manager.connect(id).await?;
    Ok(ApiResponse::ok(status))
}

pub async fn disconnect_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    state.session_manager.disconnect(id).await?;
    Ok(ApiResponse::ok(serde_json::json!({ "disconnected": true })))
}

pub async fn test_registered_connection(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let status = state.session_manager.connect(id).await?;
    Ok(ApiResponse::ok(serde_json::json!({
        "status": "CONNECTED",
        "versao": status.server_version
    })))
}
