use crate::api::ApiResponse;
use crate::domain::isql::{IsqlRequest, IsqlResult};
use crate::error::Result;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct ExecutarLegacyRequest {
    pub sql: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub confirmar: bool,
}

pub async fn execute_isql(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<IsqlRequest>,
) -> Result<Json<ApiResponse<IsqlResult>>> {
    let result = state.isql_service.execute(id, req).await?;
    Ok(ApiResponse::ok(result))
}

pub async fn execute_legacy(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<ExecutarLegacyRequest>,
) -> Result<Json<ApiResponse<IsqlResult>>> {
    let isql_req = IsqlRequest {
        sql: req.sql,
        manual_transaction: false,
        explain_plan: false,
    };
    let result = state.isql_service.execute(id, isql_req).await?;
    Ok(ApiResponse::ok(result))
}

pub async fn commit_tx(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<IsqlResult>>> {
    let result = state.isql_service.commit(id).await?;
    Ok(ApiResponse::ok(result))
}

pub async fn rollback_tx(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<IsqlResult>>> {
    let result = state.isql_service.rollback(id).await?;
    Ok(ApiResponse::ok(result))
}
