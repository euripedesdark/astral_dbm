mod api;
mod domain;
mod engine;
mod error;
mod service;
mod state;
mod storage;

use api::ApiResponse;
use axum::{
    routing::{delete, get, post, put},
    Json, Router,
};
use state::AppState;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use storage::registry::ConnectionRegistry;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,astral_dbm=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port: u16 = std::env::var("DBM_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8092);

    let data_dir = std::env::var("DBM_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let astral_dir = PathBuf::from("/etc/astral/dbm");
            if astral_dir.exists() || std::fs::create_dir_all(&astral_dir).is_ok() {
                astral_dir
            } else {
                PathBuf::from("./data")
            }
        });

    tracing::info!("Inicializando Astral DBM - Armazenamento em: {}", data_dir.display());

    // 1. Zero conexões estáticas na inicialização.
    // Carrega apenas o catálogo de perfis locais em JSON.
    let registry = Arc::new(ConnectionRegistry::load_or_init(&data_dir).await?);

    // 2. Estado compartilhado com gerenciamento dinâmico sob demanda
    let state = AppState::new(registry);

    // 3. Camada CORS ampla para acesso web
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // 4. Rotas da API REST do DBM (Compatibilidade InterBase + Web)
    let api_router = Router::new()
        // Conexões e Perfis
        .route("/conexoes", get(api::connections::list_connections).post(api::connections::create_connection))
        .route("/conexoes/{id}", put(api::connections::update_connection).delete(api::connections::delete_connection))
        .route("/conexoes/testar", post(api::connections::test_connection))
        // Sessões On-Demand
        .route("/conexoes/{id}/conectar", post(api::sessions::connect_session))
        .route("/conexoes/{id}/desconectar", post(api::sessions::disconnect_session))
        .route("/conexoes/{id}/testar", post(api::sessions::test_registered_connection))
        // Metadados InterBase (Árvore de Objetos)
        .route("/conexoes/{id}/catalogo", get(api::metadata::get_catalog))
        .route("/conexoes/{id}/schemas", get(api::metadata::get_schemas))
        .route("/conexoes/{id}/bancos", get(api::metadata::get_databases))
        .route("/conexoes/{id}/dados", get(api::metadata::browse_table))
        .route("/conexoes/{id}/dados/salvar", post(api::metadata::save_row))
        .route("/conexoes/{id}/dados/remover", post(api::metadata::delete_row))
        .route("/conexoes/{id}/estrutura", get(api::metadata::get_structure))
        .route("/conexoes/{id}/ddl", get(api::metadata::get_ddl))
        // Manutenção InterBase (Sweep, Stats, Server Log, Full DDL, Validate, Geradores, Tabela)
        .route("/conexoes/{id}/sweep", post(api::metadata::sweep_database))
        .route("/conexoes/{id}/stats", get(api::metadata::get_stats))
        .route("/conexoes/{id}/server-log", get(api::metadata::get_server_log))
        .route("/conexoes/{id}/extract-ddl", get(api::metadata::extract_full_ddl))
        .route("/conexoes/{id}/validate", post(api::metadata::validate_database))
        .route("/conexoes/{id}/generator/set-value", post(api::metadata::set_generator_value))
        .route("/conexoes/{id}/tabela/{table}", delete(api::metadata::drop_table))
        // Interactive SQL (ISQL Console)
        .route("/conexoes/{id}/isql", post(api::isql::execute_isql))
        .route("/conexoes/{id}/executar", post(api::isql::execute_legacy))
        .route("/conexoes/{id}/commit", post(api::isql::commit_tx))
        .route("/conexoes/{id}/rollback", post(api::isql::rollback_tx))
        // Compatibilidade de Drivers
        .route("/drivers", get(list_drivers))
        .route("/grupos", get(list_groups));

    let dist_dir = PathBuf::from("./dist");
    let web_dist = PathBuf::from("./web/dist");
    let static_dir = if dist_dir.exists() {
        dist_dir
    } else if web_dist.exists() {
        web_dist
    } else {
        PathBuf::from("./web")
    };

    let app = Router::new()
        .nest("/api", api_router.clone())
        .nest("/dbm/api", api_router)
        .route("/health", get(health_check))
        .route("/dbm/health", get(health_check))
        .nest_service("/dbm", ServeDir::new(&static_dir).append_index_html_on_directories(true))
        .fallback_service(ServeDir::new(&static_dir).append_index_html_on_directories(true))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    println!();
    println!("╔═══════════════════════════════════════════════════════════════════╗");
    println!("║                 ASTRAL DATABASE MANAGER (ASTRAL DBM)              ║");
    println!("║       Motor: RUST 1.99 · Runtime: TOKIO · Framework: AXUM 0.8     ║");
    println!("║       Modelo Operacional & UX: INTERBASE 2020 (IBCONSOLE)         ║");
    println!("╠═══════════════════════════════════════════════════════════════════╣");
    println!("║ [✓] Conexão no Boot : NENHUMA (100% Dinâmica Sob Demanda)         ║");
    println!("║ [✓] Autenticação DBM: DESABILITADA (Acesso livre e instantâneo)   ║");
    println!("║ [✓] Porta de Escuta : http://0.0.0.0:{:<30}║", port);
    println!("╚═══════════════════════════════════════════════════════════════════╝");
    println!();

    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "UP",
        "service": "astral-dbm",
        "engine": "rust",
        "paradigm": "interbase-ibconsole",
        "connections_on_startup": 0
    }))
}

async fn list_drivers() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    let drivers = vec![
        serde_json::json!({ "id": "postgres", "nome": "PostgreSQL (Nativo Async)", "portaPadrao": 5432, "fabricante": "PostgreSQL Global Development Group", "versao": "16+" }),
        serde_json::json!({ "id": "interbase", "nome": "Embarcadero InterBase (IB / GDB)", "portaPadrao": 3050, "fabricante": "Embarcadero", "versao": "2020" }),
        serde_json::json!({ "id": "firebird", "nome": "Firebird SQL (FDB)", "portaPadrao": 3050, "fabricante": "Firebird Project", "versao": "4/5" }),
        serde_json::json!({ "id": "mysql", "nome": "MySQL / MariaDB", "portaPadrao": 3306, "fabricante": "Oracle / MariaDB", "versao": "8.0+" }),
        serde_json::json!({ "id": "sqlite", "nome": "SQLite 3", "portaPadrao": 0, "fabricante": "SQLite", "versao": "3" }),
    ];
    ApiResponse::ok(drivers)
}

async fn list_groups() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    let groups = vec![
        serde_json::json!({ "id": "prod", "nome": "Produção" }),
        serde_json::json!({ "id": "hom", "nome": "Homologação" }),
        serde_json::json!({ "id": "dev", "nome": "Desenvolvimento" }),
    ];
    ApiResponse::ok(groups)
}
