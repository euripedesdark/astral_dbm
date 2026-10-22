use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbDomain {
    pub name: String,
    pub base_type: String,
    pub default_value: Option<String>,
    pub nullable: bool,
    pub check_clause: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbColumn {
    pub name: String,
    pub domain: Option<String>,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub position: i32,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbConstraint {
    pub name: String,
    pub constraint_type: String, // PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK
    pub columns: Vec<String>,
    pub ref_table: Option<String>,
    pub ref_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbTable {
    pub name: String,
    pub schema: String,
    pub description: Option<String>,
    pub columns: Vec<IbColumn>,
    pub constraints: Vec<IbConstraint>,
    pub indices: Vec<IbIndex>,
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbView {
    pub name: String,
    pub schema: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbProcedure {
    pub name: String,
    pub schema: String,
    pub params_in: Vec<String>,
    pub params_out: Vec<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbTrigger {
    pub name: String,
    pub schema: String,
    pub table_name: String,
    pub event_type: String,   // BEFORE, AFTER
    pub event_action: String, // INSERT, UPDATE, DELETE
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbGenerator {
    pub name: String,
    pub schema: String,
    pub current_value: i64,
    pub step: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbException {
    pub name: String,
    pub schema: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbUdf {
    pub name: String,
    pub module_name: String,
    pub entry_point: String,
    pub return_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbRole {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbDatabaseCatalog {
    pub server_version: String,
    pub database_name: String,
    pub active_charset: String,
    pub domains: Vec<IbDomain>,
    pub tables: Vec<IbTable>,
    pub views: Vec<IbView>,
    pub procedures: Vec<IbProcedure>,
    pub triggers: Vec<IbTrigger>,
    pub generators: Vec<IbGenerator>,
    pub exceptions: Vec<IbException>,
    pub udfs: Vec<IbUdf>,
    pub roles: Vec<IbRole>,
}
