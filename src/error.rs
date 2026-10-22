use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, DbmError>;

#[derive(Error, Debug)]
pub enum DbmError {
    #[error("Erro de conexão com o banco: {0}")]
    Connection(String),

    #[error("Erro de execução SQL: {0}")]
    Query(String),

    #[error("Objeto não encontrado: {0}")]
    NotFound(String),

    #[error("Erro de validação: {0}")]
    Validation(String),

    #[error("Erro de E/S de armazenamento: {0}")]
    Io(String),

    #[error("Sessão inativa ou desconectada: {0}")]
    Disconnected(String),

    #[error("Erro interno do servidor: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorBody {
    success: bool,
    erro: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    codigo: &'static str,
    mensagem: String,
}

impl IntoResponse for DbmError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            DbmError::Connection(_) => (StatusCode::BAD_GATEWAY, "DB_CONNECTION_ERROR"),
            DbmError::Query(_) => (StatusCode::BAD_REQUEST, "SQL_EXECUTION_ERROR"),
            DbmError::NotFound(_) => (StatusCode::NOT_FOUND, "OBJECT_NOT_FOUND"),
            DbmError::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR"),
            DbmError::Disconnected(_) => (StatusCode::PRECONDITION_FAILED, "SESSION_DISCONNECTED"),
            DbmError::Io(_) => (StatusCode::INTERNAL_SERVER_ERROR, "STORAGE_IO_ERROR"),
            DbmError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR"),
        };

        let body = Json(ErrorBody {
            success: false,
            erro: ErrorDetail {
                codigo: code,
                mensagem: self.to_string(),
            },
        });

        (status, body).into_response()
    }
}

impl From<tokio_postgres::Error> for DbmError {
    fn from(err: tokio_postgres::Error) -> Self {
        if let Some(db_err) = err.as_db_error() {
            let detail = db_err.detail().map(|d| format!(" ({})", d)).unwrap_or_default();
            let hint = db_err.hint().map(|h| format!(" [Dica: {}]", h)).unwrap_or_default();
            DbmError::Query(format!("{}{}{}", db_err.message(), detail, hint))
        } else {
            DbmError::Query(err.to_string())
        }
    }
}
