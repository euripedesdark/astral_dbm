use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsqlRequest {
    pub sql: String,
    #[serde(default)]
    pub manual_transaction: bool,
    #[serde(default)]
    pub explain_plan: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsqlResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
    pub plan: Option<String>,
    pub tx_status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableBrowseRequest {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub page_size: i64,
    pub search: Option<String>,
}

fn default_page() -> i64 {
    1
}
fn default_page_size() -> i64 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableBrowseResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDdlResult {
    pub table_name: String,
    pub ddl: String,
}
