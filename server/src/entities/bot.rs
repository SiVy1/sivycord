use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "bots")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub owner_id: String,
    #[sea_orm(unique)]
    pub token: String,
    pub permissions: i64,
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
