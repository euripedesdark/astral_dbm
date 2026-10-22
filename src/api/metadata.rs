use crate::api::ApiResponse;
use crate::domain::isql::{TableBrowseRequest, TableBrowseResult, TableDdlResult};
use crate::domain::metadata::IbDatabaseCatalog;
use crate::engine::postgres::PostgresEngine;
use crate::error::Result;
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct TableQuery {
    pub schema: Option<String>,
    pub tabela: Option<String>,
    pub pagina: Option<i64>,
    pub tamanho: Option<i64>,
    pub busca: Option<String>,
}

#[derive(Deserialize)]
pub struct DdlQuery {
    pub schema: Option<String>,
    pub nome: Option<String>,
    pub tabela: Option<String>,
}

#[derive(Deserialize)]
pub struct SetGenValueRequest {
    pub generator: String,
    pub value: i64,
}

pub async fn get_catalog(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<IbDatabaseCatalog>>> {
    let catalog = state.metadata_service.get_catalog(id).await?;
    Ok(ApiResponse::ok(catalog))
}

pub async fn get_schemas(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<String>>>> {
    let client = state.session_manager.get_client(id).await?;
    let rows = client
        .query(
            "SELECT schema_name FROM information_schema.schemata 
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
             ORDER BY schema_name",
            &[],
        )
        .await
        .unwrap_or_default();

    let mut schemas: Vec<String> = rows.iter().map(|r| r.get(0)).collect();
    if schemas.is_empty() {
        schemas.push("public".to_string());
    }
    Ok(ApiResponse::ok(schemas))
}

pub async fn get_databases(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>> {
    let client = state.session_manager.get_client(id).await?;
    let rows = client
        .query(
            "SELECT datname, pg_size_pretty(pg_database_size(datname)) as size 
             FROM pg_database WHERE datistemplate = false ORDER BY datname",
            &[],
        )
        .await
        .unwrap_or_default();

    let dbs: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            let name: String = r.get("datname");
            let size: Option<String> = r.get("size");
            serde_json::json!({
                "nome": name,
                "tamanho": size.unwrap_or_else(|| "0 MB".to_string()),
                "dono": "postgres"
            })
        })
        .collect();

    Ok(ApiResponse::ok(dbs))
}

pub async fn browse_table(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<TableQuery>,
) -> Result<Json<ApiResponse<TableBrowseResult>>> {
    let schema = query.schema.as_deref().unwrap_or("public");
    let table = query.tabela.as_deref().unwrap_or("");

    let req = TableBrowseRequest {
        page: query.pagina.unwrap_or(1),
        page_size: query.tamanho.unwrap_or(50),
        search: query.busca,
    };

    let result = state
        .metadata_service
        .browse_table(id, schema, table, req)
        .await?;
    Ok(ApiResponse::ok(result))
}

pub async fn get_structure(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<TableQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let catalog = state.metadata_service.get_catalog(id).await?;
    let schema = query.schema.as_deref().unwrap_or("public");
    let table = query.tabela.as_deref().unwrap_or("");

    if let Some(t) = catalog
        .tables
        .into_iter()
        .find(|t| t.schema == schema && t.name == table)
    {
        Ok(ApiResponse::ok(serde_json::json!({
            "colunas": t.columns,
            "restricoes": t.constraints,
            "indices": t.indices
        })))
    } else {
        Ok(ApiResponse::ok(serde_json::json!({
            "colunas": [],
            "restricoes": [],
            "indices": []
        })))
    }
}

pub async fn get_ddl(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<DdlQuery>,
) -> Result<Json<ApiResponse<TableDdlResult>>> {
    let schema = query.schema.as_deref().unwrap_or("public");
    let table = query
        .tabela
        .or(query.nome)
        .unwrap_or_else(|| "desconhecido".to_string());

    let ddl_res = state.metadata_service.generate_ddl(id, schema, &table).await?;
    Ok(ApiResponse::ok(ddl_res))
}

// --- NOVOS ENDPOINTS: SWEEP, STATS, SERVER LOG, DDL EXTRACTOR, VALIDATE ---

pub async fn sweep_database(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let res = PostgresEngine::sweep_database(&client).await?;
    Ok(ApiResponse::ok(res))
}

pub async fn get_stats(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let config = state.session_manager.get_config(id).await?;
    let res = PostgresEngine::get_database_stats(&client, &config.database).await?;
    Ok(ApiResponse::ok(res))
}

pub async fn get_server_log(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>> {
    let client = state.session_manager.get_client(id).await?;
    let res = PostgresEngine::get_server_log(&client).await?;
    Ok(ApiResponse::ok(res))
}

pub async fn extract_full_ddl(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let config = state.session_manager.get_config(id).await?;
    let ddl = PostgresEngine::extract_full_ddl(&client, &config).await?;
    Ok(ApiResponse::ok(serde_json::json!({ "ddl": ddl })))
}

pub async fn validate_database(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let res = PostgresEngine::validate_database(&client).await?;
    Ok(ApiResponse::ok(res))
}

pub async fn set_generator_value(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<SetGenValueRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let val = PostgresEngine::set_generator_value(&client, &req.generator, req.value).await?;
    Ok(ApiResponse::ok(serde_json::json!({
        "generator": req.generator,
        "new_value": val
    })))
}

pub async fn drop_table(
    State(state): State<AppState>,
    Path((id, table)): Path<(Uuid, String)>,
    Query(query): Query<TableQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let schema = query.schema.unwrap_or_else(|| "public".to_string());
    PostgresEngine::drop_table(&client, &schema, &table).await?;
    Ok(ApiResponse::ok(serde_json::json!({ "dropped": true, "table": table })))
}

#[derive(Deserialize)]
pub struct SaveRowRequest {
    pub schema: Option<String>,
    pub table: String,
    pub mode: Option<String>,
    #[serde(default)]
    pub keys: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub values: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
pub struct DeleteRowRequest {
    pub schema: Option<String>,
    pub table: String,
    #[serde(default)]
    pub keys: std::collections::HashMap<String, serde_json::Value>,
}

pub async fn save_row(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<SaveRowRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let schema = req.schema.as_deref().unwrap_or("public");
    let mode = req.mode.as_deref().unwrap_or("update");
    let res = PostgresEngine::save_row(&client, schema, &req.table, mode, &req.keys, &req.values).await?;
    Ok(ApiResponse::ok(res))
}

pub async fn delete_row(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<DeleteRowRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>> {
    let client = state.session_manager.get_client(id).await?;
    let schema = req.schema.as_deref().unwrap_or("public");
    let affected = PostgresEngine::delete_row(&client, schema, &req.table, &req.keys).await?;
    Ok(ApiResponse::ok(serde_json::json!({ "deleted": true, "rows_affected": affected })))
}
