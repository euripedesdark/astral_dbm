use crate::api::ApiResponse;
use crate::domain::connection::{ConnectionConfig, CreateConnectionRequest};
use crate::engine::postgres::PostgresEngine;
use crate::error::Result;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

pub async fn list_connections(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<crate::domain::connection::ConnectionStatus>>>> {
    let statuses = state.session_manager.list_statuses().await;
    Ok(ApiResponse::ok(statuses))
}

pub async fn create_connection(
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<Json<ApiResponse<ConnectionConfig>>> {
    let config = req.into_connection_config(Uuid::new_v4());
    state.registry.add(config.clone()).await?;
    Ok(ApiResponse::ok(config))
}

pub async fn update_connection(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<Json<ApiResponse<ConnectionConfig>>> {
    let config = req.into_connection_config(id);
    state.registry.update(config.clone()).await?;
    let _ = state.session_manager.disconnect(id).await;
    Ok(ApiResponse::ok(config))
}

pub async fn delete_connection(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let _ = state.session_manager.disconnect(id).await;
    state.registry.remove(id).await?;
    Ok(ApiResponse::ok(serde_json::json!({ "deleted": true })))
}

pub async fn test_connection(
    Json(req): Json<CreateConnectionRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let dummy_cfg = req.into_connection_config(Uuid::nil());
    let ver = PostgresEngine::test_connection(&dummy_cfg).await?;
    Ok(ApiResponse::ok(serde_json::json!({
        "status": "CONNECTED",
        "versao": ver
    })))
}
