use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "bans")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    pub user_name: String,
    pub reason: Option<String>,
    pub banned_by: String,
    pub created_at: String,
    #[serde(default = "default_server_id")]
    pub server_id: String,
}

fn default_server_id() -> String {
    "default".to_string()
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
