use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseEngine {
    Postgres,
    Interbase,
    Firebird,
    Mysql,
    Sqlite,
}

impl Default for DatabaseEngine {
    fn default() -> Self {
        Self::Postgres
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub engine: DatabaseEngine,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_default: Option<String>,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateConnectionRequest {
    pub name: Option<String>,
    #[serde(alias = "nome")]
    pub nome: Option<String>,

    #[serde(default)]
    pub engine: DatabaseEngine,
    #[serde(alias = "driverId")]
    pub driver_id: Option<String>,

    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub url: Option<String>,

    pub username: Option<String>,
    #[serde(alias = "usuario")]
    pub usuario: Option<String>,

    pub password: Option<String>,
    #[serde(alias = "senha")]
    pub senha: Option<String>,

    pub charset: Option<String>,
    pub role: Option<String>,

    #[serde(default)]
    pub readonly: bool,
    #[serde(alias = "somenteLeitura", default)]
    pub somente_leitura: bool,

    #[serde(alias = "esquemaPadrao")]
    pub esquema_padrao: Option<String>,
}

impl CreateConnectionRequest {
    pub fn into_connection_config(self, id: Uuid) -> ConnectionConfig {
        let name = self
            .name
            .or(self.nome)
            .unwrap_or_else(|| "Nova Conexão InterBase".to_string());

        let username = self
            .username
            .or(self.usuario)
            .unwrap_or_else(|| "postgres".to_string());

        let password = self.password.or(self.senha);
        let readonly = self.readonly || self.somente_leitura;
        let schema_default = self.esquema_padrao;

        let mut host = self.host.unwrap_or_default();
        let mut port = self.port.unwrap_or(5432);
        let mut database = self.database.unwrap_or_default();

        // Extrai parâmetros da URL se não informados individualmente
        if let Some(raw_url) = self.url {
            let clean = raw_url.trim().trim_start_matches("jdbc:");
            if let Some(idx) = clean.find("://") {
                let rest = &clean[idx + 3..];
                if let Some(slash_idx) = rest.find('/') {
                    let host_port = &rest[..slash_idx];
                    let db_part = &rest[slash_idx + 1..];
                    let db_clean = db_part.split('?').next().unwrap_or(db_part);

                    if host.is_empty() {
                        if let Some(colon) = host_port.find(':') {
                            host = host_port[..colon].to_string();
                            if let Ok(p) = host_port[colon + 1..].parse::<u16>() {
                                port = p;
                            }
                        } else {
                            host = host_port.to_string();
                        }
                    }

                    if database.is_empty() {
                        database = db_clean.to_string();
                    }
                }
            }
        }

        if host.is_empty() {
            host = "127.0.0.1".to_string();
        }
        if database.is_empty() {
            database = "postgres".to_string();
        }

        ConnectionConfig {
            id,
            name,
            engine: self.engine,
            host,
            port,
            database,
            username,
            password,
            charset: self.charset,
            role: self.role,
            readonly,
            schema_default,
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "nome")]
    pub nome: String,
    pub is_connected: bool,
    #[serde(rename = "conectado")]
    pub conectado: bool,
    pub server_version: Option<String>,
    #[serde(rename = "versao")]
    pub versao: Option<String>,
    pub connected_at: Option<DateTime<Utc>>,
    pub engine: DatabaseEngine,
    #[serde(rename = "driver")]
    pub driver: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    #[serde(rename = "usuario")]
    pub usuario: String,
    pub readonly: bool,
    #[serde(rename = "somenteLeitura")]
    pub somente_leitura: bool,
    pub url: String,
}

impl ConnectionStatus {
    pub fn from_parts(
        cfg: &ConnectionConfig,
        is_connected: bool,
        server_version: Option<String>,
        connected_at: Option<DateTime<Utc>>,
    ) -> Self {
        let url = format!("{}:{}/{}", cfg.host, cfg.port, cfg.database);
        Self {
            id: cfg.id,
            name: cfg.name.clone(),
            nome: cfg.name.clone(),
            is_connected,
            conectado: is_connected,
            server_version: server_version.clone(),
            versao: server_version,
            connected_at,
            engine: cfg.engine,
            driver: match cfg.engine {
                DatabaseEngine::Postgres => "PostgreSQL (Async)".to_string(),
                DatabaseEngine::Interbase => "InterBase 2020".to_string(),
                DatabaseEngine::Firebird => "Firebird SQL".to_string(),
                DatabaseEngine::Mysql => "MySQL / MariaDB".to_string(),
                DatabaseEngine::Sqlite => "SQLite 3".to_string(),
            },
            host: cfg.host.clone(),
            port: cfg.port,
            database: cfg.database.clone(),
            username: cfg.username.clone(),
            usuario: cfg.username.clone(),
            readonly: cfg.readonly,
            somente_leitura: cfg.readonly,
            url,
        }
    }
}
